import type { CommandOptions, CommandResult } from '../shell/index.ts';
import { parseAuthStatus } from './answers.ts';
import type { Env } from './paths.ts';
import { type AuthStatus, STATUS_TIMEOUT_MS } from './schema.ts';

export { parseAuthStatus } from './answers.ts';
export { type AuthStatus, STATUS_TIMEOUT_MS } from './schema.ts';

export type ClaudeRunner = (
  command: string[],
  cwd: string,
  options: CommandOptions
) => Promise<CommandResult>;

export async function readAuthStatus(run: ClaudeRunner, claude: string, env: Env, cwd: string) {
  const result = await run([claude, 'auth', 'status', '--json'], cwd, { env, timeoutMs: STATUS_TIMEOUT_MS });
  if (result.timedOut) {
    return {
      signIn: 'unknown',
      email: null,
      organization: null,
      plan: null,
      detail: 'Claude took too long to answer.',
    } satisfies AuthStatus;
  }
  return parseAuthStatus(result);
}
