import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { S3Client } from 'bun';
import { Config, Console, Effect, Layer, Option, Redacted, Schema } from 'effect';
import { FetchHttpClient, HttpClient, HttpClientRequest } from 'effect/http';
import { resolveChannelKey } from '../apps/marketing/src/worker/download/paths.ts';
import { DMG_NAME } from '../apps/marketing/src/worker/releases/schema.ts';
import { resolveBuildKey } from '../apps/marketing/src/worker/updates/files.ts';
import {
  BLOCKMAP_NAME,
  UPDATE_CHANNEL_FILES,
  ZIP_NAME,
} from '../apps/marketing/src/worker/updates/schema.ts';
import { Command, CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { createTempDirectory } from './kit/temp.ts';
import {
  assertDownloadFile,
  assertUpdateZip,
  DOWNLOADS_BUCKET,
  describeDownloadUpload,
  describeUpdateUpload,
  listPointerUploads,
  listUpdateUploads,
  parseDownloadRelease,
  parseStoredPointer,
  parseTokenId,
  parseUpdateFile,
  R2_ENDPOINT,
  RELEASE_VIEW_FIELDS,
  resolveChannelUpdates,
  resolveR2Credentials,
  TOKEN_VERIFY_URL,
} from './release-downloads.ts';
import { R2_REQUEST_DELAYS, retryStep, warnRetry } from './release-retry.ts';
import { recordStepSummary } from './release/actions.ts';
import { ScriptUsage, UploadFailed } from './release/schema.ts';

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const program = Effect.gen(function* () {
  const command = yield* Command;
  const client = yield* HttpClient.HttpClient;
  const settings = yield* Effect.orDie(
    Config.all({
      tag: Config.option(Config.NonEmptyString('RELEASE_TAG')),
      repository: Config.String('GITHUB_REPOSITORY').pipe(Config.withDefault('shinsa-dev/shinsa')),
      token: Config.option(Config.Redacted('CLOUDFLARE_API_TOKEN')),
    })
  );
  const tag = process.argv[2] ?? Option.getOrUndefined(settings.tag);
  if (!tag)
    return yield* new ScriptUsage({ message: 'Name the release: bun scripts/release-upload.ts v1.2.0' });
  if (Option.isNone(settings.token) || Redacted.value(settings.token.value) === '')
    return yield* new ScriptUsage({
      message: 'Set CLOUDFLARE_API_TOKEN: a token with R2 access to the bucket.',
    });
  const token = settings.token.value;

  const check = <A>(step: () => A) =>
    Effect.try({
      try: step,
      catch: (error) => new UploadFailed({ message: error instanceof Error ? error.message : String(error) }),
    });
  const request = <A>(step: () => Promise<A>) =>
    Effect.tryPromise({
      try: step,
      catch: (error) => new UploadFailed({ message: error instanceof Error ? error.message : String(error) }),
    });
  const resolveDigest = Effect.fn('releaseUpload.digest')(function* (
    file: string,
    algorithm: 'sha256' | 'sha512',
    encoding: 'hex' | 'base64'
  ) {
    const hasher = new Bun.CryptoHasher(algorithm);
    yield* Effect.promise(async () => {
      for await (const chunk of Bun.file(file).stream()) hasher.update(chunk);
    });
    return hasher.digest(encoding);
  });
  const resolveSize = Effect.fn('releaseUpload.size')(function* (file: string) {
    return Number((yield* Effect.sync(() => statSync(file))).size);
  });
  const withRetry = (label: string) => retryStep({ label, delays: R2_REQUEST_DELAYS, onRetry: warnRetry });
  const requestBucket = Effect.fn('releaseUpload.bucket')(function* () {
    const tokenId = yield* HttpClientRequest.get(TOKEN_VERIFY_URL).pipe(
      HttpClientRequest.bearerToken(Redacted.value(token)),
      client.execute,
      Effect.flatMap((response) => response.json),
      Effect.mapError(
        (error) => new UploadFailed({ message: `Could not verify CLOUDFLARE_API_TOKEN: ${error.message}` })
      ),
      Effect.flatMap((answer) => check(() => parseTokenId(answer))),
      withRetry('Verify the Cloudflare token')
    );
    const credentials = resolveR2Credentials(Redacted.value(token), tokenId);
    return new S3Client({ ...credentials, bucket: DOWNLOADS_BUCKET, endpoint: R2_ENDPOINT });
  });
  const requestPointer = Effect.fn('releaseUpload.pointer')(function* (bucket: S3Client, key: string) {
    const file = bucket.file(key);
    const read = Effect.gen(function* () {
      if (!(yield* request(() => file.exists()))) return null;
      const text = yield* request(() => file.text());
      return yield* check(() => parseStoredPointer(text));
    });
    return yield* read.pipe(withRetry(`Read ${key}`));
  });
  const writeObject = (bucket: S3Client, key: string, body: string | Blob, type: string) =>
    request(() => bucket.write(key, body, { type })).pipe(withRetry(`Upload ${key}`));

  const directory = yield* createTempDirectory('shinsa-release-');
  const view = yield* command
    .text(['gh', 'release', 'view', tag, '--repo', settings.repository, '--json', RELEASE_VIEW_FIELDS])
    .pipe(withRetry(`Read release ${tag}`));
  const release = yield* decodeJson(view).pipe(
    Effect.mapError(() => new UploadFailed({ message: 'gh did not describe a release.' })),
    Effect.flatMap((described) => check(() => parseDownloadRelease(described)))
  );
  const updateName = UPDATE_CHANNEL_FILES[release.channel];
  yield* command
    .text([
      'gh',
      'release',
      'download',
      tag,
      '--repo',
      settings.repository,
      '--pattern',
      DMG_NAME,
      '--pattern',
      ZIP_NAME,
      '--pattern',
      BLOCKMAP_NAME,
      '--pattern',
      updateName,
      '--dir',
      directory,
      '--clobber',
    ])
    .pipe(withRetry(`Download release ${tag}`));
  const dmg = join(directory, DMG_NAME);
  const zip = join(directory, ZIP_NAME);
  const dmgFile = { size: yield* resolveSize(dmg), sha256: yield* resolveDigest(dmg, 'sha256', 'hex') };
  yield* check(() => assertDownloadFile(release, dmgFile));
  const updateText = yield* Effect.sync(() => readFileSync(join(directory, updateName), 'utf8'));
  const update = yield* check(() => parseUpdateFile(release, updateText));
  const zipFile = { size: yield* resolveSize(zip), sha512: yield* resolveDigest(zip, 'sha512', 'base64') };
  yield* check(() => assertUpdateZip(release, update, zipFile));
  const bucket = yield* requestBucket();
  const current = {
    stable: yield* requestPointer(bucket, resolveChannelKey('stable')),
    beta: yield* requestPointer(bucket, resolveChannelKey('beta')),
    canary: yield* requestPointer(bucket, resolveChannelKey('canary')),
  };
  const { version } = release.pointer;
  const bodies = yield* Effect.sync(() => ({
    zip: Bun.file(zip),
    blockmap: Bun.file(join(directory, BLOCKMAP_NAME)),
    dmg: Bun.file(dmg),
  }));
  yield* writeObject(bucket, resolveBuildKey(version, ZIP_NAME), bodies.zip, 'application/zip');
  yield* writeObject(
    bucket,
    resolveBuildKey(version, BLOCKMAP_NAME),
    bodies.blockmap,
    'application/octet-stream'
  );
  yield* writeObject(bucket, release.pointer.key, bodies.dmg, 'application/x-apple-diskimage');
  const channels = resolveChannelUpdates(release, current);
  yield* Effect.forEach(listPointerUploads(release, channels), (upload) =>
    writeObject(bucket, upload.key, upload.body, 'application/json')
  );
  yield* Effect.forEach(listUpdateUploads(update, channels), (upload) =>
    writeObject(bucket, upload.key, upload.body, 'text/yaml')
  );
  const summary = `${describeDownloadUpload(release, channels, current)} ${describeUpdateUpload(release, channels)}`;
  yield* recordStepSummary(`**Downloads:** ${summary}`);
  yield* Console.log(summary);
});

program.pipe(
  Effect.scoped,
  reportFailure,
  Effect.provide(Layer.merge(CommandLayer, FetchHttpClient.layer)),
  BunRuntime.runMain({ disableErrorReporting: true })
);
