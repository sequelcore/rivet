import {
  CANON_EOS_PROPERTY,
  createCanonEosPropertyValuePayload,
  type CanonEosPropertyValueByteLength
} from "./canonProperties";

export const CANON_EOS_OPERATION = {
  GET_EVENT: 0x9116,
  GET_VIEWFINDER_DATA: 0x9153,
  SET_DEVICE_PROP_VALUE_EX: 0x9110,
  SET_EVENT_MODE: 0x9115,
  SET_REMOTE_MODE: 0x9114
} as const;

export { CANON_EOS_PROPERTY };

export interface CanonEosPropertyWrite {
  propertyCode: number;
  value: number;
  valueByteLength: 2 | 4;
}

const JPEG_BLOB_TYPES = new Set([1, 9, 11]);

export function createCanonEosLiveViewStartWrites(
  currentMode: number,
  currentOutputDevice: number,
  requestedOutputMask: number
): CanonEosPropertyWrite[] {
  const writes: CanonEosPropertyWrite[] = [];

  if (currentMode === 0) {
    writes.push({
      propertyCode: CANON_EOS_PROPERTY.EVF_MODE,
      value: 1,
      valueByteLength: 2
    });
  }

  writes.push({
    propertyCode: CANON_EOS_PROPERTY.EVF_OUTPUT_DEVICE,
    value: currentOutputDevice | requestedOutputMask,
    valueByteLength: 4
  });

  return writes;
}

export function createCanonEosPropertyPayload(
  propertyCode: number,
  value: number,
  valueByteLength: CanonEosPropertyValueByteLength
): Uint8Array {
  return createCanonEosPropertyValuePayload(propertyCode, value, valueByteLength);
}

export function extractCanonEosJpeg(frame: Uint8Array): Uint8Array {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  let offset = 0;

  while (offset < frame.byteLength) {
    if (frame.byteLength - offset < 8) {
      throw new Error("Malformed Canon EOS viewfinder blob");
    }

    const byteLength = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    if (byteLength < 8 || offset + byteLength > frame.byteLength) {
      throw new Error("Malformed Canon EOS viewfinder blob");
    }

    if (JPEG_BLOB_TYPES.has(type)) {
      const candidate = frame.slice(offset + 8, offset + byteLength);
      if (
        candidate.byteLength >= 4 &&
        candidate[0] === 0xff &&
        candidate[1] === 0xd8 &&
        candidate[candidate.byteLength - 2] === 0xff &&
        candidate[candidate.byteLength - 1] === 0xd9
      ) {
        return candidate;
      }
    }

    offset += byteLength;
  }

  throw new Error("Canon EOS viewfinder response did not contain a valid JPEG");
}
