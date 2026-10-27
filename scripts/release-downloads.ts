import {
  type Channel,
  DMG_NAME,
  type DownloadPointer,
  parseDownloadPointer,
  resolveChannelKey,
  resolveReleaseKey,
} from '../apps/marketing/src/worker/download.ts';
import { resolveVersionOrder } from '../packages/core/src/protocol/engine.ts';

export interface DownloadRelease {
  tag: string;
  channel: Channel;
  pointer: DownloadPointer;
}

export type ChannelPointers = Record<Channel, DownloadPointer | null>;

export const DOWNLOADS_BUCKET = 'shinsa-releases';

export const RELEASE_VIEW_FIELDS = 'tagName,isDraft,isPrerelease,publishedAt,assets';

export const R2_ACCOUNT_ID = 'e8563b02f2bf2b6a136f2781445a486f';

export const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const TOKEN_VERIFY_URL = `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/tokens/verify`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function selectDmgAsset(assets: unknown) {
  if (!Array.isArray(assets)) return null;
  return assets.find((asset) => isRecord(asset) && asset.name === DMG_NAME) ?? null;
}

export function parseDownloadRelease(view: unknown): DownloadRelease {
  if (!isRecord(view) || typeof view.tagName !== 'string') throw new Error('gh did not describe a release.');
  const tag = view.tagName;
  if (view.isDraft !== false) throw new Error(`${tag} is a draft; publish it first.`);
  const asset = selectDmgAsset(view.assets);
  if (!asset) throw new Error(`${tag} has no ${DMG_NAME}.`);
  const digest =
    typeof asset.digest === 'string' ? /^sha256:([0-9a-f]{64})$/.exec(asset.digest)?.[1] : undefined;
  const version = tag.replace(/^v/, '');
  const pointer = parseDownloadPointer({
    version,
    key: resolveReleaseKey(version),
    size: asset.size,
    sha256: digest,
    publishedAt: view.publishedAt,
  });
  if (!pointer) throw new Error(`${tag} is not a version, or its ${DMG_NAME} has no size, digest or date.`);
  return { tag, channel: view.isPrerelease === false ? 'stable' : 'beta', pointer };
}

export function assertDownloadFile(release: DownloadRelease, file: { size: number; sha256: string }) {
  const { pointer, tag } = release;
  if (file.size !== pointer.size || file.sha256 !== pointer.sha256)
    throw new Error(`The downloaded ${DMG_NAME} of ${tag} is not the file GitHub describes.`);
}

export function parseStoredPointer(text: string | null) {
  if (text === null) return null;
  try {
    return parseDownloadPointer(JSON.parse(text));
  } catch {
    return null;
  }
}

export function parseTokenId(answer: unknown) {
  const id = isRecord(answer) && isRecord(answer.result) ? answer.result.id : null;
  if (!isRecord(answer) || answer.success !== true || typeof id !== 'string')
    throw new Error(`CLOUDFLARE_API_TOKEN is not an active token of the account ${R2_ACCOUNT_ID}.`);
  return id;
}

export function resolveR2Credentials(token: string, tokenId: string) {
  return {
    accessKeyId: tokenId,
    secretAccessKey: new Bun.CryptoHasher('sha256').update(token).digest('hex'),
  };
}

export function resolveChannelUpdates(release: DownloadRelease, current: ChannelPointers): Channel[] {
  const channels: Channel[] = release.channel === 'stable' ? ['stable', 'beta'] : ['beta'];
  return channels.filter((channel) => {
    const pointer = current[channel];
    return !pointer || resolveVersionOrder(release.pointer.version, pointer.version) !== -1;
  });
}

export function listPointerUploads(release: DownloadRelease, channels: Channel[]) {
  return channels.map((channel) => ({
    key: resolveChannelKey(channel),
    body: `${JSON.stringify(release.pointer)}\n`,
  }));
}

export function describeDownloadUpload(
  release: DownloadRelease,
  channels: Channel[],
  current: ChannelPointers
) {
  const file = `Uploaded \`${release.pointer.key}\` to R2 (\`${DOWNLOADS_BUCKET}\`).`;
  const lines = (['stable', 'beta'] as const).map((channel) => {
    const url = channel === 'stable' ? 'shinsa.dev/download' : 'shinsa.dev/download/beta';
    if (channels.includes(channel)) return `${url} now serves ${release.pointer.version}.`;
    const kept = current[channel]?.version;
    return kept
      ? `${url} keeps ${kept}, which is newer.`
      : `${url} serves the beta until the first stable release.`;
  });
  return [file, ...lines].join(' ');
}
