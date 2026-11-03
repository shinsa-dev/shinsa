import { Effect } from 'effect';
import { resolveBrowserEnv } from '../../../../extensions/definitions.ts';
import { describeError } from '../../../../log/index.ts';
import type { ExecutableResolver } from '../executable/schema.ts';
import { type ClaudeLaunch, ClaudeSetupError, ROUTE_ENV } from './schema.ts';

export const resolveClaudeLaunch = Effect.fn('ClaudeSdk.launch')(function* (
  resolveExecutable: ExecutableResolver
) {
  const executable = yield* Effect.tryPromise({
    try: resolveExecutable,
    catch: (error) => new ClaudeSetupError({ message: describeError(error) }),
  });
  if (!executable.ok) return yield* new ClaudeSetupError({ message: executable.message });
  const env = yield* Effect.sync(() =>
    resolveBrowserEnv(Object.fromEntries(Object.entries(Bun.env).filter(([key]) => !ROUTE_ENV.includes(key))))
  );
  return {
    version: executable.version,
    options: { pathToClaudeCodeExecutable: executable.path, env },
  } satisfies ClaudeLaunch;
});
