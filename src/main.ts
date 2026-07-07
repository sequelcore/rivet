import { parseArgs, usage } from "./config";
import { probePtpIp } from "./canon/ptpIpProbe";
import { discoverCanonCameras } from "./canon/ssdpDiscovery";
import { initPtpIpCommandChannel } from "./canon/ptpIpClient";
import { initializePtpIpTransport } from "./canon/ptpIpSession";
import { MtpSession } from "./canon/mtpSession";
import { MtpTransport } from "./canon/mtpTransport";
import { collectCanonPropertyEvents } from "./canon/canonPropertyDiagnostics";
import { fetchCanonUpnpDescriptor } from "./canon/upnpDescriptor";
import { connectCanonLiveView } from "./canon/canonLiveViewConnection";
import { listLocalIpv4Interfaces } from "./network/interfaces";
import { startMjpegServer } from "./server/mjpegServer";

async function main(): Promise<void> {
  if (process.argv.includes("--help")) {
    console.log(usage());
    return;
  }

  const config = parseArgs(process.argv.slice(2));

  if (config.interfaces) {
    console.log(JSON.stringify(listLocalIpv4Interfaces(), null, 2));
    return;
  }

  if (config.discover) {
    const cameras = await discoverCanonCameras(
      config.localAddress === undefined
        ? { timeoutMs: config.discoverTimeoutMs }
        : { localAddress: config.localAddress, timeoutMs: config.discoverTimeoutMs }
    );
    console.log(JSON.stringify(cameras, null, 2));
    process.exitCode = cameras.length > 0 ? 0 : 2;
    return;
  }

  if (config.describe) {
    const location = config.descriptorLocation ?? (await discoverDescriptorLocation(config));
    const descriptor = await fetchCanonUpnpDescriptor({
      location,
      ...(config.localAddress === undefined ? {} : { localAddress: config.localAddress })
    });
    console.log(JSON.stringify(descriptor, null, 2));
    return;
  }

  if (config.probeOnly) {
    if (config.cameraIp === undefined) {
      throw new Error("Missing required --camera-ip");
    }

    const result = await probePtpIp(config.cameraIp, config.cameraPort, 2000, config.localAddress);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.reachable ? 0 : 2;
    return;
  }

  if (config.init) {
    if (config.cameraIp === undefined) {
      throw new Error("Missing required --camera-ip");
    }

    const result = await initPtpIpCommandChannel({
      host: config.cameraIp,
      port: config.cameraPort,
      ...(config.localAddress === undefined ? {} : { localAddress: config.localAddress })
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (config.mtpSmoke) {
    if (config.cameraIp === undefined) {
      throw new Error("Missing required --camera-ip");
    }

    const transport = new MtpTransport({
      host: config.cameraIp,
      port: config.cameraPort,
      timeoutMs: 5000,
      ...(config.localAddress === undefined ? {} : { localAddress: config.localAddress })
    });
    try {
      const ack = await initializePtpIpTransport(transport);
      const session = new MtpSession(transport, { sessionId: ack.connectionNumber });
      await session.openSession();
      const deviceInfo = await session.getDeviceInfo();
      console.log(
        JSON.stringify(
          {
            ok: true,
            cameraName: ack.cameraName,
            connectionNumber: ack.connectionNumber,
            deviceInfoBytes: deviceInfo.byteLength,
            firstBytesHex: Buffer.from(deviceInfo.slice(0, 32)).toString("hex")
          },
          null,
          2
        )
      );
    } finally {
      transport.close();
    }
    return;
  }

  if (config.cameraPropsWatchSeconds !== null) {
    if (config.cameraIp === undefined) {
      throw new Error("Missing required --camera-ip");
    }

    const transport = new MtpTransport({
      host: config.cameraIp,
      port: config.cameraPort,
      timeoutMs: 5000,
      ...(config.localAddress === undefined ? {} : { localAddress: config.localAddress })
    });
    try {
      const ack = await initializePtpIpTransport(transport);
      const session = new MtpSession(transport, { sessionId: ack.connectionNumber });
      await session.openSession();
      await session.getDeviceInfo();
      const events = await collectCanonPropertyEvents(session, {
        durationMs: config.cameraPropsWatchSeconds * 1000
      });
      console.log(
        JSON.stringify(
          {
            ok: true,
            cameraName: ack.cameraName,
            connectionNumber: ack.connectionNumber,
            events
          },
          null,
          2
        )
      );
    } finally {
      transport.close();
    }
    return;
  }

  if (config.serveMjpeg) {
    if (config.cameraIp === undefined) {
      throw new Error("Missing required --camera-ip");
    }

    const connection = await connectCanonLiveView({
      host: config.cameraIp,
      port: config.cameraPort,
      ...(config.localAddress === undefined ? {} : { localAddress: config.localAddress })
    });
    const server = await startMjpegServer({
      host: config.listenHost,
      port: config.listenPort,
      source: connection.source
    });

    console.log(`Canon Live View: ${server.url}/live.mjpg`);
    console.log(`Snapshot: ${server.url}/snapshot.jpg`);

    await waitForShutdown();
    await server.stop();
    connection.close();
    return;
  }

  console.log("Rivet Canon Wi-Fi bridge.");
  console.log(`Run: bun run dev -- --camera-ip ${config.cameraIp} --probe-only`);
}

async function waitForShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
}

async function discoverDescriptorLocation(config: ReturnType<typeof parseArgs>): Promise<string> {
  const cameras = await discoverCanonCameras(
    config.localAddress === undefined
      ? { timeoutMs: config.discoverTimeoutMs }
      : { localAddress: config.localAddress, timeoutMs: config.discoverTimeoutMs }
  );

  const firstCamera = cameras[0];
  if (firstCamera === undefined) {
    throw new Error("No Canon camera discovered");
  }

  return firstCamera.location;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
