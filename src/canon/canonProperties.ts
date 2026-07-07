export const CANON_EOS_PROPERTY = {
  APERTURE: 0xd101,
  SHUTTER_SPEED: 0xd102,
  ISO: 0xd103,
  WHITE_BALANCE: 0xd10a,
  CAPTURE_DESTINATION: 0xd11c,
  EVF_OUTPUT_DEVICE: 0xd1b0,
  EVF_MODE: 0xd1b1
} as const;

export type CanonEosPropertyValueByteLength = 1 | 2 | 4;

export function createCanonEosPropertyValuePayload(
  propertyCode: number,
  value: number,
  valueByteLength: number
): Uint8Array {
  if (valueByteLength !== 1 && valueByteLength !== 2 && valueByteLength !== 4) {
    throw new Error(`Unsupported Canon property value byte length: ${valueByteLength}`);
  }

  const payload = new Uint8Array(12);
  const view = new DataView(payload.buffer);
  view.setUint32(0, payload.byteLength, true);
  view.setUint32(4, propertyCode, true);

  if (valueByteLength === 1) {
    view.setUint8(8, value);
  } else if (valueByteLength === 2) {
    view.setUint16(8, value, true);
  } else {
    view.setUint32(8, value, true);
  }

  return payload;
}
