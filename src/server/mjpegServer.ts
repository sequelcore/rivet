import { createServer, type ServerResponse } from "node:http";
import type { FrameSource, FrameSourceStats } from "../canon/frameSource";

interface ObservableFrameSource extends FrameSource {
  stats?(): FrameSourceStats;
}

export interface MjpegServerOptions {
  host: string;
  port: number;
  source: ObservableFrameSource;
}

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

export interface ServerStatus {
  ok: boolean;
  streamUrl: string;
  snapshotUrl: string;
  frame: FrameSourceStats | null;
}

export function createMjpegResponse(frame: Uint8Array, boundary: string): Response {
  const body = new Blob([
    `--${boundary}\r\n`,
    "Content-Type: image/jpeg\r\n",
    `Content-Length: ${frame.byteLength}\r\n\r\n`,
    toArrayBuffer(frame),
    "\r\n"
  ]);

  return new Response(body, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      "Connection": "close",
      "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
      "Pragma": "no-cache"
    }
  });
}

export async function startMjpegServer(options: MjpegServerOptions): Promise<RunningServer> {
  const boundary = "rivet-frame";
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
      return;
    }

    if (url.pathname === "/status.json") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify(createServerStatus(options.source, options.host, options.port)));
      return;
    }

    if (url.pathname === "/") {
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": "text/html; charset=utf-8"
      });
      response.end(createStatusPage());
      return;
    }

    if (url.pathname === "/snapshot.jpg") {
      const frame = options.source.latestFrame();
      if (frame === null) {
        response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("No frame available");
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": frame.bytes.byteLength,
        "Content-Type": frame.contentType
      });
      response.end(frame.bytes);
      return;
    }

    if (url.pathname === "/live.mjpg") {
      streamFrames(options.source, boundary, response);
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;

  return {
    url: `http://${options.host}:${port}`,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error === undefined) {
            resolve();
          } else {
            reject(error);
          }
        });
      });
    }
  };
}

export function createServerStatus(
  source: ObservableFrameSource,
  host: string,
  port: number
): ServerStatus {
  return {
    ok: true,
    streamUrl: `http://${host}:${port}/live.mjpg`,
    snapshotUrl: `http://${host}:${port}/snapshot.jpg`,
    frame: source.stats?.() ?? null
  };
}

export function createStatusPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Rivet</title>
  <style>
    :root { color-scheme: dark; font-family: "Segoe UI", Tahoma, sans-serif; background: #101214; color: #f2f0ea; }
    body { margin: 0; min-height: 100vh; background: #101214; }
    main { max-width: 980px; margin: 0 auto; padding: 28px; }
    header { display: flex; justify-content: space-between; align-items: end; gap: 16px; margin-bottom: 20px; }
    h1 { margin: 0; font-size: 28px; font-weight: 650; letter-spacing: 0; }
    .status { font-size: 13px; padding: 5px 9px; border: 1px solid #3c8f6c; color: #9df0c0; background: #12251c; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(260px, .9fr); gap: 18px; }
    .preview { background: #050607; border: 1px solid #2a2d2f; min-height: 320px; display: grid; place-items: center; }
    .preview img { width: 100%; image-rendering: auto; }
    .panel { border: 1px solid #2a2d2f; background: #17191b; padding: 16px; }
    dl { display: grid; grid-template-columns: 1fr auto; gap: 10px 14px; margin: 0; }
    dt { color: #aaa59b; }
    dd { margin: 0; font-variant-numeric: tabular-nums; }
    code { color: #f6d37a; overflow-wrap: anywhere; }
    .links { margin-top: 18px; display: grid; gap: 8px; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } main { padding: 18px; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Rivet</h1>
      <div class="status" id="status">starting</div>
    </header>
    <section class="grid">
      <div class="preview"><img src="/snapshot.jpg" id="preview" alt="Canon Live View"></div>
      <aside class="panel">
        <dl>
          <dt>FPS</dt><dd id="fps">0</dd>
          <dt>Resolution</dt><dd id="resolution">unknown</dd>
          <dt>Frames</dt><dd id="frames">0</dd>
          <dt>Avg frame</dt><dd id="bytes">0 KB</dd>
          <dt>Last frame</dt><dd id="last">none</dd>
        </dl>
        <div class="links">
          <code id="stream">http://127.0.0.1:8787/live.mjpg</code>
          <code id="snapshot">http://127.0.0.1:8787/snapshot.jpg</code>
        </div>
      </aside>
    </section>
  </main>
  <script>
    async function refresh() {
      const response = await fetch('/status.json', { cache: 'no-store' });
      const status = await response.json();
      const frame = status.frame || {};
      document.getElementById('status').textContent = frame.status || 'unknown';
      document.getElementById('fps').textContent = frame.fps ?? 0;
      document.getElementById('resolution').textContent = frame.width && frame.height ? frame.width + 'x' + frame.height : 'unknown';
      document.getElementById('frames').textContent = frame.totalFrames ?? 0;
      document.getElementById('bytes').textContent = Math.round((frame.averageFrameBytes || 0) / 1024) + ' KB';
      document.getElementById('last').textContent = frame.lastFrameAt ? new Date(frame.lastFrameAt).toLocaleTimeString() : 'none';
      document.getElementById('stream').textContent = status.streamUrl;
      document.getElementById('snapshot').textContent = status.snapshotUrl;
      document.getElementById('preview').src = '/snapshot.jpg?t=' + Date.now();
    }
    refresh();
    setInterval(refresh, 1000);
  </script>
</body>
</html>`;
}

function streamFrames(source: ObservableFrameSource, boundary: string, response: ServerResponse): void {
  const abortController = new AbortController();
  response.writeHead(200, {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Connection": "keep-alive",
    "Content-Type": `multipart/x-mixed-replace; boundary=${boundary}`,
    "Pragma": "no-cache"
  });

  response.once("close", () => {
    abortController.abort();
  });

  void (async () => {
    try {
      for await (const frame of source.frames(abortController.signal)) {
        response.write(`--${boundary}\r\n`);
        response.write("Content-Type: image/jpeg\r\n");
        response.write(`Content-Length: ${frame.bytes.byteLength}\r\n\r\n`);
        response.write(frame.bytes);
        response.write("\r\n");
      }
      response.end();
    } catch (error) {
      console.error("MJPEG stream failed", error);
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  })();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
