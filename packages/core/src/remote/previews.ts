import {
  concatBytes,
  decodeText,
  encodeText,
  parseBase32,
  parseBase64Url,
  serializeBase32,
  serializeBase64Url,
} from './bytes.ts';

export const PREVIEW_ORIGIN = 'https://shinsa.page';

export const PREVIEW_ID_BYTES = 10;

export const PREVIEW_KEY_BYTES = 32;

export const PREVIEW_KEY_PARAM = 'key';

export const PREVIEW_TUNNEL_PREFIX = '/__preview/';

export const PREVIEW_KEY_HEADER = 'x-shinsa-preview-key';

export const PREVIEW_PAGE_HEADER = 'x-shinsa-preview-page';

export const PREVIEW_GONE = 'This preview is no longer shared.';

export const PREVIEW_STOPPED =
  'The service behind this preview is not running. This page works again once it starts.';

export const PREVIEW_OFFLINE =
  'The machine that shares this preview is offline. This page works again once it is back.';

const LABEL_LIMIT = 63;

const SEGMENT = /^[A-Za-z0-9_-]+$/;

export interface PreviewAddress {
  instanceId: string;
  previewId: string;
}

export interface PreviewLink extends PreviewAddress {
  key: string;
}

function hasBytes(text: string, length: number) {
  return SEGMENT.test(text) && parseBase64Url(text)?.length === length;
}

export function isPreviewId(value: string) {
  return hasBytes(value, PREVIEW_ID_BYTES);
}

export function isPreviewKey(value: string) {
  return hasBytes(value, PREVIEW_KEY_BYTES);
}

export function serializePreviewLabel(address: PreviewAddress) {
  const id = parseBase64Url(address.previewId) ?? new Uint8Array();
  return serializeBase32(concatBytes(id, encodeText(address.instanceId)));
}

export function parsePreviewLabel(label: string): PreviewAddress | null {
  if (label.length > LABEL_LIMIT) return null;
  const bytes = parseBase32(label);
  if (!bytes || bytes.length <= PREVIEW_ID_BYTES) return null;
  try {
    const instanceId = decodeText(bytes.slice(PREVIEW_ID_BYTES));
    if (!SEGMENT.test(instanceId)) return null;
    return { instanceId, previewId: serializeBase64Url(bytes.slice(0, PREVIEW_ID_BYTES)) };
  } catch {
    return null;
  }
}

export function resolvePreviewOrigin(address: PreviewAddress, zoneOrigin = PREVIEW_ORIGIN) {
  const zone = new URL(zoneOrigin);
  return `${zone.protocol}//${serializePreviewLabel(address)}.${zone.host}`;
}

export function serializePreviewUrl(link: PreviewLink, zoneOrigin = PREVIEW_ORIGIN) {
  return `${resolvePreviewOrigin(link, zoneOrigin)}/?${PREVIEW_KEY_PARAM}=${link.key}`;
}

export function parsePreviewHost(host: string, zoneOrigin = PREVIEW_ORIGIN): PreviewAddress | null {
  const suffix = `.${new URL(zoneOrigin).host}`;
  const lower = host.toLowerCase();
  if (!lower.endsWith(suffix)) return null;
  const label = lower.slice(0, -suffix.length);
  return label.includes('.') ? null : parsePreviewLabel(label);
}

export function parsePreviewUrl(url: string | null, zoneOrigin = PREVIEW_ORIGIN): PreviewLink | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== new URL(zoneOrigin).protocol) return null;
    const address = parsePreviewHost(parsed.host, zoneOrigin);
    const key = parsed.searchParams.get(PREVIEW_KEY_PARAM);
    if (!(address && key && isPreviewKey(key))) return null;
    return { ...address, key };
  } catch {
    return null;
  }
}

export function resolvePreviewTunnelPath(previewId: string, path: string) {
  return `${PREVIEW_TUNNEL_PREFIX}${previewId}${path.startsWith('/') ? path : `/${path}`}`;
}

export function parsePreviewTunnelPath(pathname: string) {
  if (!pathname.startsWith(PREVIEW_TUNNEL_PREFIX)) return null;
  const rest = pathname.slice(PREVIEW_TUNNEL_PREFIX.length);
  const slash = rest.indexOf('/');
  const previewId = slash === -1 ? rest : rest.slice(0, slash);
  if (!isPreviewId(previewId)) return null;
  return { previewId, path: slash === -1 ? '/' : rest.slice(slash) };
}

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function serializePreviewPage(message: string) {
  const text = message.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Shinsa preview</title>',
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;color:#3f3f46;background:#fafafa}p{max-width:28rem;padding:0 1.5rem;text-align:center}@media (prefers-color-scheme:dark){body{color:#d4d4d8;background:#18181b}}</style>',
    `</head><body><p>${text}</p></body></html>`,
  ].join('');
}
