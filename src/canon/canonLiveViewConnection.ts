import { networkInterfaces } from "node:os";
import { CANON_EOS_OPERATION } from "./canonEos";
import type { FrameSource } from "./frameSource";
import { LiveViewBootstrap } from "./liveViewBootstrap";
import { CanonLiveViewFrameSource } from "./liveViewFrameSource";
import { MtpSession } from "./mtpSession";
import { MtpTransport } from "./mtpTransport";
import { PtpIpEventChannel } from "./ptpIpEventChannel";
import { ReconnectingFrameSource } from "./reconnectingFrameSource";
import { initializePtpIpTransport } from "./ptpIpSession";
import { SharedFrameSource } from "./sharedFrameSource";

const ACCEPTED_EVENT_RESPONSE_CODES = [0x2001, 0x2019, 0xa102];

export interface CanonLiveViewConnectionOptions {
  host: string;
  port: number;
  localAddress?: string;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  retryDelayMs?: number;
}

export interface CanonLiveViewConnection {
  source: FrameSource;
  close(): void;
}

export async function connectCanonLiveView(
  options: CanonLiveViewConnectionOptions
): Promise<CanonLiveViewConnection> {
  const source = new SharedFrameSource(
    new ReconnectingFrameSource({
      retryDelayMs: options.retryDelayMs ?? 1_000,
      async connect() {
        return await connectCanonLiveViewWithRetry(options);
      }
    })
  );

  return {
    source,
    close() {
      source.close();
    }
  };
}

async function connectCanonLiveViewWithRetry(
  options: CanonLiveViewConnectionOptions
): Promise<CanonLiveViewConnection> {
  const deadline = Date.now() + (options.connectTimeoutMs ?? 120_000);
  let lastError: unknown;

  do {
    if (
      options.localAddress !== undefined &&
      !isLocalAddressAvailable(options.localAddress)
    ) {
      lastError = new Error(`Local address ${options.localAddress} is not available`);
      await delay(options.retryDelayMs ?? 500);
      continue;
    }

    try {
      return await connectCanonLiveViewOnce(options);
    } catch (error) {
      lastError = error;
      if (!isRetryableConnectionError(error) || Date.now() >= deadline) {
        throw error;
      }
      await delay(options.retryDelayMs ?? 500);
    }
  } while (Date.now() < deadline);

  throw lastError;
}

async function connectCanonLiveViewOnce(
  options: CanonLiveViewConnectionOptions
): Promise<CanonLiveViewConnection> {
  const transportOptions = {
    host: options.host,
    port: options.port,
    timeoutMs: options.timeoutMs ?? 10_000,
    ...(options.localAddress === undefined ? {} : { localAddress: options.localAddress })
  };
  const commandTransport = new MtpTransport(transportOptions);
  const eventTransport = new MtpTransport(transportOptions);

  try {
    console.log("Canon: opening command channel");
    const ack = await initializePtpIpTransport(commandTransport);
    console.log(`Canon: command channel accepted as ${ack.cameraName.trim()}`);
    const eventChannel = new PtpIpEventChannel(eventTransport);
    await eventChannel.initialize(ack.connectionNumber);
    console.log("Canon: event channel accepted");

    const session = new MtpSession(commandTransport, {
      sessionId: ack.connectionNumber
    });
    await session.openSession();
    console.log("Canon: MTP session open");
    await session.getDeviceInfo();
    console.log("Canon: device info received");

    const bootstrap = new LiveViewBootstrap(session);
    await bootstrap.start();
    console.log("Canon: Live View initialized");
    await delay(1_000);

    const liveViewSource = new CanonLiveViewFrameSource({
      async pollEvents() {
        await session.executeCameraCommand({
          operationCode: CANON_EOS_OPERATION.GET_EVENT,
          parameters: [],
          acceptedResponseCodes: ACCEPTED_EVENT_RESPONSE_CODES
        });
      },
      async getViewfinderData() {
        return await bootstrap.getViewfinderData();
      },
      retryDelayMs: 50
    });
    const source = new SharedFrameSource(liveViewSource);

    return {
      source,
      close() {
        source.close();
        eventChannel.close();
        session.close();
      }
    };
  } catch (error) {
    eventTransport.close();
    commandTransport.close();
    throw error;
  }
}

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = "code" in error ? String(error.code) : "";
  return (
    code === "ECONNABORTED" ||
    code === "ECONNREFUSED" ||
    code === "ETIMEDOUT" ||
    error.message.startsWith("Timed out after ")
  );
}

function isLocalAddressAvailable(address: string): boolean {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .some((entry) => entry.family === "IPv4" && entry.address === address);
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
