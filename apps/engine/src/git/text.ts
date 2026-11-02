const DECODER = new TextDecoder();

export function decodeText(bytes: Uint8Array) {
  return DECODER.decode(bytes);
}

export function splitRecords(bytes: Uint8Array) {
  return decodeText(bytes)
    .split('\0')
    .filter((record) => record.length > 0);
}
