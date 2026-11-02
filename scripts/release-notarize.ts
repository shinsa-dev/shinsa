import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { $ } from 'bun';
import {
  describeNotaryRejection,
  NOTARY_SUBMIT_DELAYS,
  parseNotarySubmission,
  type RetryFailure,
  resolveNotaryCredentials,
  retryStep,
  STAPLE_DELAYS,
  serializeRetryWarning,
} from './release-retry.ts';

const app = Bun.argv[2];
if (!app) throw new Error('Name the app: bun scripts/release-notarize.ts release/mac-arm64/Shinsa.app');
const credentials = resolveNotaryCredentials(Bun.env);
const directory = mkdtempSync(join(tmpdir(), 'shinsa-notarize-'));

function warnRetry(failure: RetryFailure) {
  process.stdout.write(serializeRetryWarning(failure, Bun.env));
}

try {
  const archive = join(directory, `${basename(app, '.app')}.zip`);
  await $`ditto -c -k --sequesterRsrc --keepParent ${app} ${archive}`;
  const output = await retryStep(
    async () =>
      $`xcrun notarytool submit ${archive} --apple-id ${credentials.appleId} --password ${credentials.password} --team-id ${credentials.teamId} --wait --output-format json`.text(),
    { label: 'Notarize', delays: NOTARY_SUBMIT_DELAYS, sleep: Bun.sleep, onRetry: warnRetry }
  );
  const submission = parseNotarySubmission(output);
  if (submission.status !== 'Accepted') {
    const log =
      await $`xcrun notarytool log ${submission.id} --apple-id ${credentials.appleId} --password ${credentials.password} --team-id ${credentials.teamId}`
        .nothrow()
        .text();
    throw new Error(describeNotaryRejection(submission, log));
  }
  await retryStep(async () => $`xcrun stapler staple ${app}`, {
    label: 'Staple',
    delays: STAPLE_DELAYS,
    sleep: Bun.sleep,
    onRetry: warnRetry,
  });
  process.stdout.write(`Notarized and stapled ${app} (submission ${submission.id}).\n`);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
