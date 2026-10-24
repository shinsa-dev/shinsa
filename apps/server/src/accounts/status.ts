import type { AccountSignIn } from '@shinsa/core';
import type { CommandOptions, CommandResult } from '../shell/index.ts';
import type { Env } from './paths.ts';

export interface AuthStatus {
  signIn: AccountSignIn;
  email: string | null;
  organization: string | null;
  plan: string | null;
  detail: string | null;
}

export type ClaudeRunner = (
  command: string[],
  cwd: string,
  options: CommandOptions
) => Promise<CommandResult>;

export const STATUS_TIMEOUT_MS = 15_000;

type Fields = Record<string, unknown>;

function readText(fields: Fields, key: string) {
  const value = fields[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseAuthJson(output: string): Fields | null {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(output.slice(start, end + 1)) as Fields;
  } catch {
    return null;
  }
}

function readEmail(fields: Fields) {
  const account = fields.oauthAccount as Fields | undefined;
  return (
    readText(fields, 'email') ??
    readText(fields, 'account') ??
    (account ? readText(account, 'emailAddress') : null)
  );
}

export function parseAuthStatus(result: CommandResult): AuthStatus {
  const fields = parseAuthJson(result.stdout);
  if (!fields) {
    const detail = (result.stderr || result.stdout).split('\n')[0]?.trim() || null;
    return { signIn: 'unknown', email: null, organization: null, plan: null, detail };
  }
  if (fields.loggedIn !== true) {
    return { signIn: 'signed_out', email: null, organization: null, plan: null, detail: 'Not signed in.' };
  }
  return {
    signIn: 'signed_in',
    email: readEmail(fields),
    organization: readText(fields, 'orgName'),
    plan: readText(fields, 'subscriptionType'),
    detail: null,
  };
}

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
