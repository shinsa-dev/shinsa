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

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type ChannelPointers = Record<Channel, DownloadPointer | null>;

export const DOWNLOADS_BUCKET = 'shinsa-releases';

export const RELEASE_VIEW_FIELDS = 'tagName,isDraft,isPrerelease,publishedAt,assets';

export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

const MISSING_KEY = 'The specified key does not exist';

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
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error(`${DMG_NAME} is ${file.size} bytes; wrangler uploads at most ${MAX_UPLOAD_BYTES}.`);
}

export function parseStoredPointer(result: CommandResult) {
  if (result.exitCode === 0) {
    try {
      return parseDownloadPointer(JSON.parse(result.stdout));
    } catch {
      return null;
    }
  }
  if (result.stderr.includes(MISSING_KEY)) return null;
  throw new Error(`Reading a channel pointer failed: ${result.stderr.trim()}`);
}

export function resolveChannelUpdates(release: DownloadRelease, current: ChannelPointers): Channel[] {
  const channels: Channel[] = release.channel === 'stable' ? ['stable', 'beta'] : ['beta'];
  return channels.filter((channel) => {
    const pointer = current[channel];
    return !pointer || resolveVersionOrder(release.pointer.version, pointer.version) !== -1;
  });
}

export function resolveObjectPath(key: string) {
  return `${DOWNLOADS_BUCKET}/${key}`;
}

export function listPointerUploads(release: DownloadRelease, channels: Channel[]) {
  return channels.map((channel) => ({
    path: resolveObjectPath(resolveChannelKey(channel)),
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
