import { Clock, Effect } from 'effect';
import { HEAD_TIMEOUT } from '../git/schema.ts';
import { Git } from '../git/service.ts';
import { BUNDLE, type ShinsaBundle } from './bundle.ts';
import { createServerInstance, INSTALL_PATH } from './install.ts';

export const resolveServerInstance = Effect.fn('ServerInstance.resolve')(function* (
  installPath: string = INSTALL_PATH,
  bundle: ShinsaBundle | null = BUNDLE
) {
  const now = yield* Clock.currentTimeMillis;
  if (bundle) return createServerInstance(bundle.commit, now, bundle);
  const git = yield* Git;
  const head = yield* git.attempt(['rev-parse', 'HEAD'], installPath, { timeout: HEAD_TIMEOUT });
  const commit = head.ok && /^[0-9a-f]{40}$/.test(head.stdout) ? head.stdout : null;
  return createServerInstance(commit, now);
});
