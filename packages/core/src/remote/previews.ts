import { Effect, Option } from 'effect';
import { parseJsonRecord } from '../domain/records.ts';
import { HOUR_MS, MINUTE_MS } from '../domain/time.ts';
import {
  type Bytes,
  concatBytes,
  decodeText,
  encodeText,
  hasBytes,
  parseBase32,
  parseBase64Url,
  serializeBase32,
  serializeBase64Url,
  URL_SAFE_SEGMENT,
} from './bytes.ts';
import { createSignedToken, findHmacKey, signHmac, verifySignedToken } from './tokens.ts';

export const PREVIEW_ORIGIN = 'https://shinsa.page';

export const PREVIEW_ID_BYTES = 10;

export const PREVIEW_KEY_BYTES = 32;

export const PREVIEW_KEY_PARAM = 'key';

export const PREVIEW_TUNNEL_PREFIX = '/__preview/';

export const PREVIEW_KEY_HEADER = 'x-shinsa-preview-key';

export const PREVIEW_PAGE_HEADER = 'x-shinsa-preview-page';

export const PREVIEW_ACCESS_PARAM = 'access';

export const PREVIEW_ACCESS_HEADER = 'x-shinsa-preview-access';

export const PREVIEW_OPEN_TTL_MS = MINUTE_MS;

export const PREVIEW_ACCESS_TTL_MS = 12 * HOUR_MS;

const ACCESS_CONTEXT = encodeText('shinsa-preview-access\n');

const PRIVATE_ID_CONTEXT = 'shinsa-private-preview\n';

const LABEL_LIMIT = 63;

const selectText = Option.liftThrowable(decodeText);

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

export function isPreviewId(value: string) {
  return hasBytes(value, PREVIEW_ID_BYTES);
}

export function isPreviewKey(value: string) {
  return hasBytes(value, PREVIEW_KEY_BYTES);
}

export function serializePreviewLabel(address: PreviewAddress) {
  const id = Option.getOrElse(parseBase64Url(address.previewId), () => new Uint8Array());
  return serializeBase32(concatBytes(id, encodeText(address.instanceId)));
}

export function parsePreviewLabel(label: string): Option.Option<PreviewAddress> {
  if (label.length > LABEL_LIMIT) return Option.none();
  return Option.flatMap(
    Option.filter(parseBase32(label), (bytes) => bytes.length > PREVIEW_ID_BYTES),
    (bytes) =>
      Option.map(
        Option.filter(selectText(bytes.slice(PREVIEW_ID_BYTES)), (instanceId) =>
          URL_SAFE_SEGMENT.test(instanceId)
        ),
        (instanceId) => ({ instanceId, previewId: serializeBase64Url(bytes.slice(0, PREVIEW_ID_BYTES)) })
      )
  );
}

export function resolvePreviewOrigin(address: PreviewAddress, zoneOrigin = PREVIEW_ORIGIN) {
  const zone = new URL(zoneOrigin);
  return `${zone.protocol}//${serializePreviewLabel(address)}.${zone.host}`;
}

export function serializePreviewUrl(link: PreviewLink, zoneOrigin = PREVIEW_ORIGIN) {
  return `${resolvePreviewOrigin(link, zoneOrigin)}/?${PREVIEW_KEY_PARAM}=${link.key}`;
}

export function parsePreviewHost(host: string, zoneOrigin = PREVIEW_ORIGIN): Option.Option<PreviewAddress> {
  const suffix = `.${new URL(zoneOrigin).host}`;
  const lower = host.toLowerCase();
  if (!lower.endsWith(suffix)) return Option.none();
  const label = lower.slice(0, -suffix.length);
  return label.includes('.') ? Option.none() : parsePreviewLabel(label);
}

export function parsePreviewUrl(url: string | null, zoneOrigin = PREVIEW_ORIGIN): Option.Option<PreviewLink> {
  if (!url || !URL.canParse(url)) return Option.none();
  const parsed = new URL(url);
  if (parsed.protocol !== new URL(zoneOrigin).protocol) return Option.none();
  const key = parsed.searchParams.get(PREVIEW_KEY_PARAM);
  if (!(key && isPreviewKey(key))) return Option.none();
  return Option.map(parsePreviewHost(parsed.host, zoneOrigin), (address) => ({ ...address, key }));
}

export function resolvePreviewTunnelPath(previewId: string, path: string) {
  return `${PREVIEW_TUNNEL_PREFIX}${previewId}${path.startsWith('/') ? path : `/${path}`}`;
}

export function parsePreviewTunnelPath(pathname: string) {
  if (!pathname.startsWith(PREVIEW_TUNNEL_PREFIX)) return Option.none();
  const rest = pathname.slice(PREVIEW_TUNNEL_PREFIX.length);
  const slash = rest.indexOf('/');
  const previewId = slash === -1 ? rest : rest.slice(0, slash);
  if (!isPreviewId(previewId)) return Option.none();
  return Option.some({ previewId, path: slash === -1 ? '/' : rest.slice(slash) });
}

export const resolvePrivatePreviewId = Effect.fn('resolvePrivatePreviewId')(function* (
  connectKey: string,
  run: PrivatePreviewRun
) {
  const key = yield* findHmacKey(connectKey, 'The connect key is not valid.');
  const message = encodeText(`${PRIVATE_ID_CONTEXT}${run.serviceId}\n${run.taskId ?? ''}`);
  const digest = yield* signHmac(key, message);
  return serializeBase64Url(digest.slice(0, PREVIEW_ID_BYTES));
});

export function resolvePrivatePreviewUrl(
  address: PreviewAddress,
  localUrl: string,
  zoneOrigin = PREVIEW_ORIGIN
) {
  const local = new URL(localUrl);
  return `${resolvePreviewOrigin(address, zoneOrigin)}${local.pathname}${local.search}${local.hash}`;
}

function readAccessClaim(payload: Bytes): PreviewAccessClaim | null {
  const text = Option.getOrNull(selectText(payload));
  const fields = text === null ? undefined : Option.getOrUndefined(parseJsonRecord(text));
  if (typeof fields?.i !== 'string' || typeof fields.p !== 'string') return null;
  if (typeof fields.u !== 'string' || typeof fields.e !== 'number') return null;
  return { instanceId: fields.i, previewId: fields.p, userId: fields.u, expiresAt: fields.e };
}

export const createPreviewAccessToken = Effect.fn('createPreviewAccessToken')(function* (
  connectKey: string,
  claim: PreviewAccessClaim
) {
  const key = yield* findHmacKey(connectKey, 'The connect key is not valid.');
  const payload = encodeText(
    JSON.stringify({ i: claim.instanceId, p: claim.previewId, u: claim.userId, e: claim.expiresAt })
  );
  return yield* createSignedToken(key, ACCESS_CONTEXT, payload);
});

export const verifyPreviewAccessToken = Effect.fn('verifyPreviewAccessToken')(function* (
  connectKey: string,
  token: string,
  address: PreviewAddress,
  now: number,
  ttlMs = PREVIEW_ACCESS_TTL_MS
) {
  const payload = yield* verifySignedToken(connectKey, ACCESS_CONTEXT, token);
  if (!payload) return null;
  const claim = readAccessClaim(payload);
  if (!claim || claim.instanceId !== address.instanceId || claim.previewId !== address.previewId) return null;
  if (claim.expiresAt <= now || claim.expiresAt > now + ttlMs) return null;
  return claim;
});
