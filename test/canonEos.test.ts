import { describe, expect, test } from "bun:test";
import {
  createCanonEosLiveViewStartWrites,
  createCanonEosPropertyPayload,
  extractCanonEosJpeg
} from "../src/canon/canonEos";

describe("Canon EOS protocol helpers", () => {
  test("creates a padded SetDevicePropValueEx payload", () => {
    expect(createCanonEosPropertyPayload(0xd1b1, 1, 2)).toEqual(
      new Uint8Array([
        12, 0, 0, 0,
        0xb1, 0xd1, 0, 0,
        1, 0, 0, 0
      ])
    );
  });

  test("matches Camera Connect StartEvf property writes", () => {
    expect(createCanonEosLiveViewStartWrites(0, 0, 8)).toEqual([
      { propertyCode: 0xd1b1, value: 1, valueByteLength: 2 },
      { propertyCode: 0xd1b0, value: 8, valueByteLength: 4 }
    ]);

    expect(createCanonEosLiveViewStartWrites(1, 2, 8)).toEqual([
      { propertyCode: 0xd1b0, value: 10, valueByteLength: 4 }
    ]);
  });

  test("extracts JPEG bytes from a Canon viewfinder blob", () => {
    const metadata = canonBlob(2, new Uint8Array([9, 8]));
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 0xff, 0xd9]);
    const frame = concat(metadata, canonBlob(1, jpeg));

    expect(extractCanonEosJpeg(frame)).toEqual(jpeg);
  });

  test("rejects a typed viewfinder blob without JPEG markers", () => {
    expect(() => extractCanonEosJpeg(canonBlob(9, new Uint8Array([1, 2, 3])))).toThrow(
      "Canon EOS viewfinder response did not contain a valid JPEG"
    );
  });

  test("rejects a truncated JPEG viewfinder blob", () => {
    const truncated = new Uint8Array([0xff, 0xd8, 1, 2]);
    expect(() => extractCanonEosJpeg(canonBlob(11, truncated))).toThrow(
      "Canon EOS viewfinder response did not contain a valid JPEG"
    );
  });

  test("rejects malformed Canon viewfinder blobs", () => {
    const malformed = new Uint8Array([20, 0, 0, 0, 1, 0, 0, 0, 0xff]);
    expect(() => extractCanonEosJpeg(malformed)).toThrow("Malformed Canon EOS viewfinder blob");
  });
});

function canonBlob(type: number, bytes: Uint8Array): Uint8Array {
  const blob = new Uint8Array(8 + bytes.byteLength);
  const view = new DataView(blob.buffer);
  view.setUint32(0, blob.byteLength, true);
  view.setUint32(4, type, true);
  blob.set(bytes, 8);
  return blob;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
