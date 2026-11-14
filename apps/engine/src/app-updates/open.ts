import { dirname } from 'node:path';
import { Effect } from 'effect';
import { resolveRealPath } from '../cli/app.ts';
import { runCommand } from '../shell/command.ts';
import { resolveCarryingApp } from './control.ts';
import { APP_OPEN_TIMEOUT_MS, AppOpenFailed } from './schema.ts';

export const resolveEngineApp = Effect.fn('AppUpdates.resolveEngineApp')(function* (
  program: string = process.execPath
) {
  return resolveCarryingApp(yield* resolveRealPath(program));
});

export const openAppInBackground = Effect.fn('AppUpdates.openAppInBackground')(function* (app: string) {
  const result = yield* runCommand(['open', '-g', app], dirname(app), { timeoutMs: APP_OPEN_TIMEOUT_MS });
  if (!result.ok)
    return yield* new AppOpenFailed({ message: result.stderr.trim() || 'Shinsa for Mac did not open.' });
});
