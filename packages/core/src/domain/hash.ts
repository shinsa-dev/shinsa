const FNV_OFFSET = 0x811c9dc5;

const FNV_PRIME = 0x01000193;

export function hashText(text: string) {
  let hash = FNV_OFFSET;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}
