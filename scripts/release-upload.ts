import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, S3Client } from 'bun';
import { DMG_NAME, resolveChannelKey } from '../apps/marketing/src/worker/download.ts';
import {
  BLOCKMAP_NAME,
  resolveBuildKey,
  UPDATE_CHANNEL_FILES,
  ZIP_NAME,
} from '../apps/marketing/src/worker/updates.ts';
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
import { R2_REQUEST_DELAYS, retryStep, serializeRetryWarning } from './release-retry.ts';

const tag = Bun.argv[2] ?? Bun.env.RELEASE_TAG;
if (!tag) throw new Error('Name the release: bun scripts/release-upload.ts v1.2.0');
const repository = Bun.env.GITHUB_REPOSITORY ?? 'shinsa-dev/shinsa';
const token = Bun.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN: a token with R2 access to the bucket.');
const directory = mkdtempSync(join(tmpdir(), 'shinsa-release-'));

function requestWithRetry<T>(label: string, step: () => Promise<T>) {
  return retryStep(step, {
    label,
    delays: R2_REQUEST_DELAYS,
    sleep: Bun.sleep,
    onRetry: (failure) => process.stdout.write(serializeRetryWarning(failure, Bun.env)),
  });
}

async function requestBucket() {
  const tokenId = await requestWithRetry('Verify the Cloudflare token', async () => {
    const answer = await fetch(TOKEN_VERIFY_URL, { headers: { Authorization: `Bearer ${token}` } });
    return parseTokenId(await answer.json());
  });
  const credentials = resolveR2Credentials(token as string, tokenId);
  return new S3Client({ ...credentials, bucket: DOWNLOADS_BUCKET, endpoint: R2_ENDPOINT });
}

function requestPointer(bucket: S3Client, key: string) {
  return requestWithRetry(`Read ${key}`, async () => {
    const file = bucket.file(key);
    if (!(await file.exists())) return null;
    return parseStoredPointer(await file.text());
  });
}

function writeObject(bucket: S3Client, key: string, body: string | Blob, type: string) {
  return requestWithRetry(`Upload ${key}`, () => bucket.write(key, body, { type }));
}

async function requestDigest(path: string, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64') {
  const hasher = new Bun.CryptoHasher(algorithm);
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest(encoding);
}

try {
  const release = parseDownloadRelease(
    await requestWithRetry(`Read release ${tag}`, () =>
      $`gh release view ${tag} --repo ${repository} --json ${RELEASE_VIEW_FIELDS}`.json()
    )
  );
  const updateName = UPDATE_CHANNEL_FILES[release.channel];
  await requestWithRetry(
    `Download release ${tag}`,
    async () =>
      $`gh release download ${tag} --repo ${repository} --pattern ${DMG_NAME} --pattern ${ZIP_NAME} --pattern ${BLOCKMAP_NAME} --pattern ${updateName} --dir ${directory} --clobber`
  );
  const dmg = join(directory, DMG_NAME);
  const zip = join(directory, ZIP_NAME);
  assertDownloadFile(release, {
    size: Bun.file(dmg).size,
    sha256: await requestDigest(dmg, 'sha256', 'hex'),
  });
  const update = parseUpdateFile(release, await Bun.file(join(directory, updateName)).text());
  assertUpdateZip(release, update, {
    size: Bun.file(zip).size,
    sha512: await requestDigest(zip, 'sha512', 'base64'),
  });
  const bucket = await requestBucket();
  const current = {
    stable: await requestPointer(bucket, resolveChannelKey('stable')),
    beta: await requestPointer(bucket, resolveChannelKey('beta')),
    canary: await requestPointer(bucket, resolveChannelKey('canary')),
  };
  const { version } = release.pointer;
  await writeObject(bucket, resolveBuildKey(version, ZIP_NAME), Bun.file(zip), 'application/zip');
  await writeObject(
    bucket,
    resolveBuildKey(version, BLOCKMAP_NAME),
    Bun.file(join(directory, BLOCKMAP_NAME)),
    'application/octet-stream'
  );
  await writeObject(bucket, release.pointer.key, Bun.file(dmg), 'application/x-apple-diskimage');
  const channels = resolveChannelUpdates(release, current);
  for (const upload of listPointerUploads(release, channels)) {
    await writeObject(bucket, upload.key, upload.body, 'application/json');
  }
  for (const upload of listUpdateUploads(update, channels)) {
    await writeObject(bucket, upload.key, upload.body, 'text/yaml');
  }
  const summary = `${describeDownloadUpload(release, channels, current)} ${describeUpdateUpload(release, channels)}`;
  if (Bun.env.GITHUB_STEP_SUMMARY)
    appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `**Downloads:** ${summary}\n\n`);
  process.stdout.write(`${summary}\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
