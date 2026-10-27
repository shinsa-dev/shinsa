import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import { DMG_NAME, resolveChannelKey } from '../apps/marketing/src/worker/download.ts';
import {
  assertDownloadFile,
  describeDownloadUpload,
  listPointerUploads,
  parseDownloadRelease,
  parseStoredPointer,
  RELEASE_VIEW_FIELDS,
  resolveChannelUpdates,
  resolveObjectPath,
} from './release-downloads.ts';

const tag = Bun.argv[2] ?? Bun.env.RELEASE_TAG;
if (!tag) throw new Error('Name the release: bun scripts/release-upload.ts v1.2.0');
const repository = Bun.env.GITHUB_REPOSITORY ?? 'shinsa-dev/shinsa';
const marketing = new URL('../apps/marketing/', import.meta.url).pathname;
const directory = mkdtempSync(join(tmpdir(), 'shinsa-release-'));

async function requestPointer(key: string) {
  const result = await $`bun x wrangler r2 object get ${resolveObjectPath(key)} --remote --pipe`
    .cwd(marketing)
    .quiet()
    .nothrow();
  return parseStoredPointer({
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  });
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
  const current = {
    stable: await requestPointer(resolveChannelKey('stable')),
    beta: await requestPointer(resolveChannelKey('beta')),
  };
  await $`bun x wrangler r2 object put ${resolveObjectPath(release.pointer.key)} --file ${dmg} --content-type application/x-apple-diskimage --remote`.cwd(
    marketing
  );
  const channels = resolveChannelUpdates(release, current);
  for (const upload of listPointerUploads(release, channels)) {
    const file = join(directory, 'pointer.json');
    writeFileSync(file, upload.body);
    await $`bun x wrangler r2 object put ${upload.path} --file ${file} --content-type application/json --remote`.cwd(
      marketing
    );
  }
  const summary = describeDownloadUpload(release, channels, current);
  if (Bun.env.GITHUB_STEP_SUMMARY)
    appendFileSync(Bun.env.GITHUB_STEP_SUMMARY, `**Downloads:** ${summary}\n\n`);
  process.stdout.write(`${summary}\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
