import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $, S3Client } from 'bun';
import { DMG_NAME, resolveChannelKey } from '../apps/marketing/src/worker/download.ts';
import {
  assertDownloadFile,
  DOWNLOADS_BUCKET,
  describeDownloadUpload,
  listPointerUploads,
  listStaleCanaryKeys,
  parseDownloadRelease,
  parseStoredPointer,
  parseTokenId,
  R2_ENDPOINT,
  RELEASE_VIEW_FIELDS,
  RELEASES_PREFIX,
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

async function listReleaseKeys(bucket: S3Client) {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await bucket.list({ prefix: RELEASES_PREFIX, continuationToken });
    keys.push(...(page.contents ?? []).map((object) => object.key));
    continuationToken = page.isTruncated ? page.nextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

async function requestSha256(path: string) {
  const hasher = new Bun.CryptoHasher('sha256');
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);
  return hasher.digest('hex');
}

try {
  const release = parseDownloadRelease(
    await $`gh release view ${tag} --repo ${repository} --json ${RELEASE_VIEW_FIELDS}`.json()
  );
  await $`gh release download ${tag} --repo ${repository} --pattern ${DMG_NAME} --dir ${directory}`;
  const dmg = join(directory, DMG_NAME);
  assertDownloadFile(release, { size: Bun.file(dmg).size, sha256: await requestSha256(dmg) });
  const bucket = await requestBucket();
  const current = {
    stable: await requestPointer(bucket, resolveChannelKey('stable')),
    beta: await requestPointer(bucket, resolveChannelKey('beta')),
    canary: await requestPointer(bucket, resolveChannelKey('canary')),
  };
  await bucket.write(release.pointer.key, Bun.file(dmg), { type: 'application/x-apple-diskimage' });
  const channels = resolveChannelUpdates(release, current);
  for (const upload of listPointerUploads(release, channels)) {
    await bucket.write(upload.key, upload.body, { type: 'application/json' });
  }
  const stale = listStaleCanaryKeys(await listReleaseKeys(bucket));
  for (const key of stale) await bucket.delete(key);
  const removed = stale.length > 0 ? ` Removed ${stale.length} older canary disk images.` : '';
  const summary = `${describeDownloadUpload(release, channels, current)}${removed}`;
  if (Bun.env.GITHUB_STEP_SUMMARY)
    appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `**Downloads:** ${summary}\n\n`);
  process.stdout.write(`${summary}\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
