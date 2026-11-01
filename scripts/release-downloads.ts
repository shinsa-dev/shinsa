import {
  type Channel,
  DMG_NAME,
  type DownloadPointer,
  parseDownloadPointer,
  resolveChannelKey,
  resolveReleaseKey,
} from '../apps/marketing/src/worker/download.ts';
import { resolveUpdateKey, UPDATE_CHANNEL_FILES, ZIP_NAME } from '../apps/marketing/src/worker/updates.ts';
import { resolveReleaseChannel, resolveVersionOrder } from '../packages/core/src/protocol/engine.ts';

export interface DownloadRelease {
  tag: string;
  channel: Channel;
  pointer: DownloadPointer;
}

export type ChannelPointers = Record<Channel, DownloadPointer | null>;

export interface UpdateZip {
  version: string;
  size: number;
  sha512: string;
  releaseDate: string;
}

export const DOWNLOADS_BUCKET = 'shinsa-releases';

export const RELEASE_VIEW_FIELDS = 'tagName,isDraft,isPrerelease,publishedAt,assets';

export const R2_ACCOUNT_ID = 'e8563b02f2bf2b6a136f2781445a486f';

export const R2_ENDPOINT = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

export const TOKEN_VERIFY_URL = `https://api.cloudflare.com/client/v4/accounts/${R2_ACCOUNT_ID}/tokens/verify`;

const REACHED_CHANNELS: Record<Channel, Channel[]> = {
  stable: ['stable', 'beta'],
  beta: ['beta'],
  canary: ['canary'],
};

const DESCRIBED_CHANNELS: Record<Channel, Channel[]> = {
  stable: ['stable', 'beta'],
  beta: ['stable', 'beta'],
  canary: ['canary'],
};

const UPDATE_LABELS: Record<Channel, string> = { stable: 'Stable', beta: 'Beta', canary: 'Canary' };

const DOWNLOAD_PATHS: Record<Channel, string> = {
  stable: 'shinsa.dev/download',
  beta: 'shinsa.dev/download/beta',
  canary: 'shinsa.dev/download/canary',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function selectDmgAsset(assets: unknown) {
  if (!Array.isArray(assets)) return null;
  return assets.find((asset) => isRecord(asset) && asset.name === DMG_NAME) ?? null;
}

function resolvePrereleaseChannel(version: string): Channel {
  return resolveReleaseChannel(version) === 'canary' ? 'canary' : 'beta';
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
  const channel = view.isPrerelease === false ? 'stable' : resolvePrereleaseChannel(version);
  return { tag, channel, pointer };
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
  return REACHED_CHANNELS[release.channel].filter((channel) => {
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

function describeChannel(
  release: DownloadRelease,
  channel: Channel,
  channels: Channel[],
  current: ChannelPointers
) {
  const url = DOWNLOAD_PATHS[channel];
  if (channels.includes(channel)) return `${url} now serves ${release.pointer.version}.`;
  const kept = current[channel]?.version;
  if (!kept) return `${url} serves the beta until the first stable release.`;
  if (REACHED_CHANNELS[release.channel].includes(channel)) return `${url} keeps ${kept}, which is newer.`;
  return `${url} still serves ${kept}.`;
}

export function describeDownloadUpload(
  release: DownloadRelease,
  channels: Channel[],
  current: ChannelPointers
) {
  const file = `Uploaded \`${release.pointer.key}\` to R2 (\`${DOWNLOADS_BUCKET}\`).`;
  const lines = DESCRIBED_CHANNELS[release.channel].map((channel) =>
    describeChannel(release, channel, channels, current)
  );
  return [file, ...lines].join(' ');
}

export function parseUpdateFile(release: DownloadRelease, text: string): UpdateZip {
  const name = UPDATE_CHANNEL_FILES[release.channel];
  const failure = new Error(
    `The ${name} of ${release.tag} does not describe its ${ZIP_NAME} as ${release.pointer.version}.`
  );
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(text);
  } catch {
    throw failure;
  }
  if (!isRecord(parsed) || parsed.version !== release.pointer.version || !Array.isArray(parsed.files))
    throw failure;
  const zip = parsed.files.find((file) => isRecord(file) && file.url === ZIP_NAME);
  const releaseDate = parsed.releaseDate;
  if (
    !isRecord(zip) ||
    typeof zip.sha512 !== 'string' ||
    !Number.isSafeInteger(zip.size) ||
    (zip.size as number) <= 0 ||
    typeof releaseDate !== 'string'
  )
    throw failure;
  return { version: parsed.version, size: zip.size as number, sha512: zip.sha512, releaseDate };
}

export function assertUpdateZip(
  release: DownloadRelease,
  zip: UpdateZip,
  file: { size: number; sha512: string }
) {
  if (file.size !== zip.size || file.sha512 !== zip.sha512)
    throw new Error(
      `The downloaded ${ZIP_NAME} of ${release.tag} is not the file its ${UPDATE_CHANNEL_FILES[release.channel]} describes.`
    );
}

export function serializeUpdateFile(zip: UpdateZip) {
  const url = JSON.stringify(`${zip.version}/${ZIP_NAME}`);
  const sha512 = JSON.stringify(zip.sha512);
  return [
    `version: ${JSON.stringify(zip.version)}`,
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sha512}`,
    `    size: ${zip.size}`,
    `path: ${url}`,
    `sha512: ${sha512}`,
    `releaseDate: ${JSON.stringify(zip.releaseDate)}`,
    '',
  ].join('\n');
}

export function listUpdateUploads(zip: UpdateZip, channels: Channel[]) {
  return channels.map((channel) => ({
    key: resolveUpdateKey(UPDATE_CHANNEL_FILES[channel]),
    body: serializeUpdateFile(zip),
  }));
}

export function describeUpdateUpload(release: DownloadRelease, channels: Channel[]) {
  const { version } = release.pointer;
  if (channels.length === 0)
    return `No update channel moves to ${version}: each already offers a newer version.`;
  const names = channels.map((channel) => UPDATE_LABELS[channel]).join(' and ');
  const offer = channels.length === 1 ? 'channel offers' : 'channels offer';
  return `The ${names} update ${offer} ${version} from shinsa.dev/updates.`;
}
