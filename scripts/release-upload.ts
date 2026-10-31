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

const tag = Bun.argv[2] ?? Bun.env.RELEASE_TAG;
if (!tag) throw new Error('Name the release: bun scripts/release-upload.ts v1.2.0');
const repository = Bun.env.GITHUB_REPOSITORY ?? 'shinsa-dev/shinsa';
const token = Bun.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Set CLOUDFLARE_API_TOKEN: a token with R2 access to the bucket.');
const directory = mkdtempSync(join(tmpdir(), 'shinsa-release-'));

async function requestBucket() {
  const answer = await fetch(TOKEN_VERIFY_URL, { headers: { Authorization: `Bearer ${token}` } });
  const credentials = resolveR2Credentials(token as string, parseTokenId(await answer.json()));
  return new S3Client({ ...credentials, bucket: DOWNLOADS_BUCKET, endpoint: R2_ENDPOINT });
}

async function requestPointer(bucket: S3Client, key: string) {
  const file = bucket.file(key);
  if (!(await file.exists())) return null;
  return parseStoredPointer(await file.text());
}

async function requestDigest(path: string, algorithm: 'sha256' | 'sha512', encoding: 'hex' | 'base64') {
  const hasher = new Bun.CryptoHasher(algorithm);
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest(encoding);
}

try {
  const release = parseDownloadRelease(
    await $`gh release view ${tag} --repo ${repository} --json ${RELEASE_VIEW_FIELDS}`.json()
  );
  const updateName = UPDATE_CHANNEL_FILES[release.channel];
  await $`gh release download ${tag} --repo ${repository} --pattern ${DMG_NAME} --pattern ${ZIP_NAME} --pattern ${BLOCKMAP_NAME} --pattern ${updateName} --dir ${directory}`;
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
  await bucket.write(resolveBuildKey(version, ZIP_NAME), Bun.file(zip), { type: 'application/zip' });
  await bucket.write(resolveBuildKey(version, BLOCKMAP_NAME), Bun.file(join(directory, BLOCKMAP_NAME)), {
    type: 'application/octet-stream',
  });
  await bucket.write(release.pointer.key, Bun.file(dmg), { type: 'application/x-apple-diskimage' });
  const channels = resolveChannelUpdates(release, current);
  for (const upload of listPointerUploads(release, channels)) {
    await bucket.write(upload.key, upload.body, { type: 'application/json' });
  }
  for (const upload of listUpdateUploads(update, channels)) {
    await bucket.write(upload.key, upload.body, { type: 'text/yaml' });
  }
  const summary = `${describeDownloadUpload(release, channels, current)} ${describeUpdateUpload(release, channels)}`;
  if (Bun.env.GITHUB_STEP_SUMMARY)
    appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `**Downloads:** ${summary}\n\n`);
  process.stdout.write(`${summary}\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
