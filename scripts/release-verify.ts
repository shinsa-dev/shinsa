import { $ } from 'bun';
import { type RetryFailure, retryStep, STAPLE_DELAYS, serializeRetryWarning } from './release-retry.ts';

const app = Bun.argv[2];
if (!app) throw new Error('Name the app: bun scripts/release-verify.ts release/mac-arm64/Shinsa.app');

function warnRetry(failure: RetryFailure) {
  process.stdout.write(serializeRetryWarning(failure, Bun.env));
}

await retryStep(async () => $`spctl --assess --type execute --verbose=2 ${app}`, {
  label: 'Gatekeeper',
  delays: STAPLE_DELAYS,
  sleep: Bun.sleep,
  onRetry: warnRetry,
});
await retryStep(async () => $`xcrun stapler validate ${app}`, {
  label: 'Validate the staple',
  delays: STAPLE_DELAYS,
  sleep: Bun.sleep,
  onRetry: warnRetry,
});
process.stdout.write(`Gatekeeper accepts ${app} and its notarization ticket is stapled.\n`);
