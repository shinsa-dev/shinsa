import {
  type Bytes,
  concatBytes,
  decodeText,
  encodeText,
  parseBase32,
  parseBase64Url,
  serializeBase32,
  serializeBase64Url,
} from './bytes.ts';
import { importConnectKey } from './connect-token.ts';

export const PREVIEW_ORIGIN = 'https://shinsa.page';

export const PREVIEW_ID_BYTES = 10;

export const PREVIEW_KEY_BYTES = 32;

export const PREVIEW_KEY_PARAM = 'key';

export const PREVIEW_TUNNEL_PREFIX = '/__preview/';

export const PREVIEW_KEY_HEADER = 'x-shinsa-preview-key';

export const PREVIEW_PAGE_HEADER = 'x-shinsa-preview-page';

export const PREVIEW_ACCESS_PARAM = 'access';

export const PREVIEW_ACCESS_HEADER = 'x-shinsa-preview-access';

export const PREVIEW_OPEN_TTL_MS = 60_000;

export const PREVIEW_ACCESS_TTL_MS = 12 * 60 * 60_000;

const ACCESS_CONTEXT = 'shinsa-preview-access\n';

const PRIVATE_ID_CONTEXT = 'shinsa-private-preview\n';

const LABEL_LIMIT = 63;

const SEGMENT = /^[A-Za-z0-9_-]+$/;

export interface PreviewAddress {
  instanceId: string;
  previewId: string;
}

export interface PreviewLink extends PreviewAddress {
  key: string;
}

export interface PreviewAccessClaim extends PreviewAddress {
  userId: string;
  expiresAt: number;
}

export interface PrivatePreviewRun {
  serviceId: string;
  taskId: string | null;
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

export async function resolvePrivatePreviewId(connectKey: string, run: PrivatePreviewRun) {
  const key = await importConnectKey(connectKey);
  if (!key) throw new Error('The connect key is not valid.');
  const message = encodeText(`${PRIVATE_ID_CONTEXT}${run.serviceId}\n${run.taskId ?? ''}`);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message));
  return serializeBase64Url(digest.slice(0, PREVIEW_ID_BYTES));
}

export function resolvePrivatePreviewUrl(
  address: PreviewAddress,
  localUrl: string,
  zoneOrigin = PREVIEW_ORIGIN
) {
  const local = new URL(localUrl);
  return `${resolvePreviewOrigin(address, zoneOrigin)}${local.pathname}${local.search}${local.hash}`;
}

function readAccessClaim(payload: Bytes): PreviewAccessClaim | null {
  try {
    const fields = JSON.parse(decodeText(payload)) as Record<string, unknown>;
    if (typeof fields.i !== 'string' || typeof fields.p !== 'string') return null;
    if (typeof fields.u !== 'string' || typeof fields.e !== 'number') return null;
    return { instanceId: fields.i, previewId: fields.p, userId: fields.u, expiresAt: fields.e };
  } catch {
    return null;
  }
}

export async function createPreviewAccessToken(connectKey: string, claim: PreviewAccessClaim) {
  const key = await importConnectKey(connectKey);
  if (!key) throw new Error('The connect key is not valid.');
  const payload = encodeText(
    JSON.stringify({ i: claim.instanceId, p: claim.previewId, u: claim.userId, e: claim.expiresAt })
  );
  const signed = concatBytes(encodeText(ACCESS_CONTEXT), payload);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, signed));
  return `${serializeBase64Url(payload)}.${serializeBase64Url(signature)}`;
}

export async function verifyPreviewAccessToken(
  connectKey: string,
  token: string,
  address: PreviewAddress,
  now: number,
  ttlMs = PREVIEW_ACCESS_TTL_MS
): Promise<PreviewAccessClaim | null> {
  const [encoded, encodedSignature, extra] = token.split('.');
  if (encoded === undefined || encodedSignature === undefined || extra !== undefined) return null;
  const payload = parseBase64Url(encoded);
  const signature = parseBase64Url(encodedSignature);
  const key = await importConnectKey(connectKey);
  if (!payload || !signature || !key) return null;
  const signed = concatBytes(encodeText(ACCESS_CONTEXT), payload);
  if (!(await crypto.subtle.verify('HMAC', key, signature, signed))) return null;
  const claim = readAccessClaim(payload);
  if (!claim || claim.instanceId !== address.instanceId || claim.previewId !== address.previewId) return null;
  if (claim.expiresAt <= now || claim.expiresAt > now + ttlMs) return null;
  return claim;
}
