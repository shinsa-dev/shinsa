import { PREVIEW_COOKIES } from './schema.ts';

export function isPreviewHost(host: string, previewOrigin: string) {
  const zone = new URL(previewOrigin).host;
  const lower = host.toLowerCase();
  return lower === zone || lower.endsWith(`.${zone}`);
}

export function resolveForwardCookie(header: string | null) {
  const kept = (header ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !PREVIEW_COOKIES.has(part.split('=')[0] ?? ''));
  return kept.length > 0 ? kept.join('; ') : null;
}
