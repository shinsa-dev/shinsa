import { Effect } from 'effect';
import { parseAuthStatus } from '../answers.ts';
import type { Env } from '../paths.ts';
import { type AuthStatus, STATUS_TIMEOUT_MS } from '../schema.ts';
import type { ClaudeCommand } from './schema.ts';

export const readAuthStatus = Effect.fn('AuthStatus.read')(function* <E>(
  run: ClaudeCommand<E>,
  claude: string,
  env: Env,
  cwd: string
) {
  const result = yield* run([claude, 'auth', 'status', '--json'], cwd, { env, timeoutMs: STATUS_TIMEOUT_MS });
  if (!result.timedOut) return parseAuthStatus(result);
  const status: AuthStatus = {
    signIn: 'unknown',
    email: null,
    organization: null,
    plan: null,
    detail: 'Claude took too long to answer.',
  };
  return status;
});
