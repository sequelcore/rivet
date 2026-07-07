import { extractCanonEosJpeg } from "./canonEos";
import type { FrameSource, VideoFrame } from "./frameSource";

const OK = 0x2001;
const RETRYABLE_RESPONSE_CODES = new Set([0xa102, 0x2019]);

interface ViewfinderResponse {
  responseCode: number;
  bytes: Uint8Array;
}

export interface CanonLiveViewFrameSourceOptions {
  pollEvents(): Promise<void>;
  getViewfinderData(): Promise<ViewfinderResponse>;
  retryDelayMs?: number;
  now?: () => Date;
}

export class CanonLiveViewFrameSource implements FrameSource {
  private currentFrame: VideoFrame | null = null;
  private readonly retryDelayMs: number;
  private readonly now: () => Date;

  constructor(private readonly options: CanonLiveViewFrameSourceOptions) {
    this.retryDelayMs = options.retryDelayMs ?? 10;
    this.now = options.now ?? (() => new Date());
  }

  latestFrame(): VideoFrame | null {
    return this.currentFrame;
  }

  async *frames(signal: AbortSignal): AsyncIterable<VideoFrame> {
    while (!signal.aborted) {
      const response = await this.options.getViewfinderData();
      if (signal.aborted) {
        return;
      }

      if (RETRYABLE_RESPONSE_CODES.has(response.responseCode)) {
        await this.options.pollEvents();
        if (!(await waitForRetry(this.retryDelayMs, signal))) {
          return;
        }
        continue;
      }

      if (response.responseCode !== OK) {
        throw new Error(
          `Unexpected Canon viewfinder response code: 0x${response.responseCode.toString(16)}`
        );
      }

      const bytes = tryExtractJpeg(response.bytes);
      if (bytes === null) {
        continue;
      }

      const frame: VideoFrame = {
        bytes,
        contentType: "image/jpeg",
        capturedAt: this.now()
      };
      this.currentFrame = frame;
      yield frame;
    }
  }
}

function tryExtractJpeg(bytes: Uint8Array): Uint8Array | null {
  try {
    return extractCanonEosJpeg(bytes);
  } catch {
    return null;
  }
}

async function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) {
    return false;
  }

  if (delayMs <= 0) {
    return true;
  }

  return await new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);

    function onAbort(): void {
      clearTimeout(timeout);
      resolve(false);
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}
