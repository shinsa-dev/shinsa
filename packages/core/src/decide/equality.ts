export function isSameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}
