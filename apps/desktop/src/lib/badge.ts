export function resolveBadgeText(count: unknown) {
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) return '';
  return String(count);
}
