import { Effect } from 'effect';
import { resolveBrowserEnv } from '../../../../extensions/definitions.ts';
import type { ExecutableResolver } from '../executable/schema.ts';
import { type ClaudeLaunch, ClaudeSetupError, ROUTE_ENV } from './schema.ts';

export const resolveClaudeLaunch = Effect.fn('ClaudeSdk.launch')(function* (
  resolveExecutable: ExecutableResolver,
  browserEndpoint: string | null = null
) {
  const executable = yield* resolveExecutable;
  if (!executable.ok) return yield* new ClaudeSetupError({ message: executable.message });
  const env = yield* Effect.sync(() =>
    resolveBrowserEnv(
      Object.fromEntries(Object.entries(Bun.env).filter(([key]) => !ROUTE_ENV.includes(key))),
      [],
      browserEndpoint
    )
  );
  return {
    version: executable.version,
    options: { pathToClaudeCodeExecutable: executable.path, env },
  } satisfies ClaudeLaunch;
});
