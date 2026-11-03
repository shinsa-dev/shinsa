import { Effect } from 'effect';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { Env } from './paths.ts';
import { ClaudeCommandFailed, type ClaudeRunner } from './status/schema.ts';
import { readAuthStatus as readAuthStatusEffect } from './status/service.ts';

export { parseAuthStatus } from './answers.ts';
export { STATUS_TIMEOUT_MS } from './schema.ts';
export type { ClaudeRunner } from './status/schema.ts';

export function readAuthStatus(run: ClaudeRunner, claude: string, env: Env, cwd: string) {
  return edgeRuntime.runPromise(
    readAuthStatusEffect(
      (command, at, options) =>
        Effect.tryPromise({
          try: () => run(command, at, options),
          catch: (error) => new ClaudeCommandFailed({ message: describeError(error) }),
        }),
      claude,
      env,
      cwd
    )
  );
}
