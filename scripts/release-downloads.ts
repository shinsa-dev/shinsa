import { Array as List, Option, Result, Schema } from 'effect';
import { resolveChannelKey, resolveReleaseKey } from '../apps/marketing/src/worker/download/paths.ts';
import { parseDownloadPointer } from '../apps/marketing/src/worker/releases/pointer.ts';
import { type Channel, DMG_NAME, DownloadPointer } from '../apps/marketing/src/worker/releases/schema.ts';
import { resolveUpdateKey } from '../apps/marketing/src/worker/updates/files.ts';
import { UPDATE_CHANNEL_FILES, ZIP_NAME } from '../apps/marketing/src/worker/updates/schema.ts';
import { resolveReleaseChannel, resolveVersionOrder } from '../packages/core/src/protocol/engine.ts';
import {
  AssetDigest,
  DmgAsset,
  ReleaseAssets,
  ReleaseView,
  TokenAnswer,
  UpdateFile,
  UploadFailed,
  ZipEntry,
  ZipEntryName,
} from './release/schema.ts';

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

const decodeView = Schema.decodeUnknownOption(ReleaseView);

const decodeAssets = Schema.decodeUnknownOption(ReleaseAssets);

const decodeDmg = Schema.decodeUnknownOption(DmgAsset);

const decodeDigest = Schema.decodeUnknownOption(AssetDigest);

const decodeStoredPointer = Schema.decodeUnknownOption(Schema.fromJsonString(DownloadPointer));

const decodeTokenAnswer = Schema.decodeUnknownOption(TokenAnswer);

const decodeUpdateFile = Schema.decodeUnknownOption(UpdateFile);

const decodeZipEntry = Schema.decodeUnknownOption(ZipEntry);

const isZipEntry = Schema.is(ZipEntryName);

function refuse(message: string) {
  return new UploadFailed({ message });
}

function resolvePrereleaseChannel(version: string): Channel {
  return resolveReleaseChannel(version) === 'canary' ? 'canary' : 'beta';
}

export function parseDownloadRelease(described: unknown): Result.Result<DownloadRelease, UploadFailed> {
  return Result.gen(function* () {
    const view = yield* Result.fromOption(decodeView(described), () =>
      refuse('gh did not describe a release.')
    );
    const tag = view.tagName;
    if (view.isDraft !== false) return yield* Result.fail(refuse(`${tag} is a draft; publish it first.`));
    const assets = Option.getOrElse(decodeAssets(view.assets), () => []);
    const asset = yield* Result.fromOption(
      List.findFirst(assets, (entry) => decodeDmg(entry)),
      () => refuse(`${tag} has no ${DMG_NAME}.`)
    );
    const version = tag.replace(/^v/, '');
    const pointer = yield* Result.fromNullishOr(
      parseDownloadPointer({
        version,
        key: resolveReleaseKey(version),
        size: asset.size,
        sha256: Option.getOrUndefined(decodeDigest(asset.digest))?.slice('sha256:'.length),
        publishedAt: view.publishedAt,
      }),
      () => refuse(`${tag} is not a version, or its ${DMG_NAME} has no size, digest or date.`)
    );
    const channel = view.isPrerelease === false ? 'stable' : resolvePrereleaseChannel(version);
    return { tag, channel, pointer };
  });
}

export function assertDownloadFile(
  release: DownloadRelease,
  file: { size: number; sha256: string }
): Result.Result<void, UploadFailed> {
  const { pointer, tag } = release;
  if (file.size !== pointer.size || file.sha256 !== pointer.sha256)
    return Result.fail(refuse(`The downloaded ${DMG_NAME} of ${tag} is not the file GitHub describes.`));
  return Result.void;
}

export function parseStoredPointer(text: string): Option.Option<DownloadPointer> {
  return decodeStoredPointer(text);
}

export function parseTokenId(answer: unknown): Result.Result<string, UploadFailed> {
  return Result.fromOption(
    Option.map(decodeTokenAnswer(answer), (token) => token.result.id),
    () => refuse(`CLOUDFLARE_API_TOKEN is not an active token of the account ${R2_ACCOUNT_ID}.`)
  );
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
    return !pointer || !Option.contains(resolveVersionOrder(release.pointer.version, pointer.version), -1);
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

export function parseUpdateFile(
  release: DownloadRelease,
  text: string
): Result.Result<UpdateZip, UploadFailed> {
  const failure = () =>
    refuse(
      `The ${UPDATE_CHANNEL_FILES[release.channel]} of ${release.tag} does not describe its ${ZIP_NAME} as ${release.pointer.version}.`
    );
  return Result.gen(function* () {
    const parsed = yield* Result.try({ try: (): unknown => Bun.YAML.parse(text), catch: failure });
    const file = yield* Result.fromOption(decodeUpdateFile(parsed), failure);
    if (file.version !== release.pointer.version) return yield* Result.fail(failure());
    const zip = yield* Result.fromOption(
      Option.flatMap(List.findFirst(file.files, isZipEntry), decodeZipEntry),
      failure
    );
    return { version: file.version, size: zip.size, sha512: zip.sha512, releaseDate: file.releaseDate };
  });
}

export function assertUpdateZip(
  release: DownloadRelease,
  zip: UpdateZip,
  file: { size: number; sha512: string }
): Result.Result<void, UploadFailed> {
  if (file.size !== zip.size || file.sha512 !== zip.sha512)
    return Result.fail(
      refuse(
        `The downloaded ${ZIP_NAME} of ${release.tag} is not the file its ${UPDATE_CHANNEL_FILES[release.channel]} describes.`
      )
    );
  return Result.void;
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
