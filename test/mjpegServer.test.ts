import { describe, expect, test } from "bun:test";
import { createMjpegResponse, createServerStatus, createStatusPage } from "../src/server/mjpegServer";

describe("createMjpegResponse", () => {
  test("builds an MJPEG multipart response with jpeg content", async () => {
    const response = createMjpegResponse(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "frame");

    expect(response.headers.get("content-type")).toBe("multipart/x-mixed-replace; boundary=frame");

    const body = await response.text();
    expect(body).toContain("--frame");
    expect(body).toContain("Content-Type: image/jpeg");
    expect(body).toContain("Content-Length: 4");
  });
});

describe("status helpers", () => {
  test("builds public stream status from observable frame source", () => {
    expect(
      createServerStatus(
        {
          latestFrame: () => null,
          async *frames() {},
          stats: () => ({
            averageFrameBytes: 98_000,
            error: null,
            fps: 12.5,
            height: 320,
            lastFrameAt: new Date("2026-06-18T12:00:00.000Z"),
            status: "streaming",
            totalFrames: 120,
            width: 480
          })
        },
        "127.0.0.1",
        8787
      )
    ).toMatchObject({
      frame: {
        fps: 12.5,
        status: "streaming",
        width: 480
      },
      snapshotUrl: "http://127.0.0.1:8787/snapshot.jpg",
      streamUrl: "http://127.0.0.1:8787/live.mjpg"
    });
  });

  test("renders the local preview page", () => {
    const html = createStatusPage();

    expect(html).toContain("/status.json");
    expect(html).toContain("/snapshot.jpg");
    expect(html).toContain("Rivet");
  });
});
