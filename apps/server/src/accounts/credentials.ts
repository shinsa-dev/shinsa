import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from '../log/index.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import {
  type Env,
  resolveKeychainAccount,
  resolveKeychainService,
  resolveSharedConfigDir,
  selectConfiguredDir,
} from './paths.ts';

export interface StoredLogin {
  accessToken: string;
  plan: string | null;
}

export type SecretReader = (service: string, account: string) => Promise<string | null>;

export type SecretRunner = (
  command: string[],
  cwd: string,
  options: { timeoutMs: number }
) => Promise<CommandResult>;

const SECURITY = '/usr/bin/security';

const KEYCHAIN_TIMEOUT_MS = 5_000;

const NOT_FOUND = 44;

export function createKeychainReader(
  run: SecretRunner = runCommand,
  platform = process.platform
): SecretReader {
  return async (service, account) => {
    if (platform !== 'darwin') return null;
    const result = await run(
      [SECURITY, 'find-generic-password', '-a', account, '-s', service, '-w'],
      homedir(),
      {
        timeoutMs: KEYCHAIN_TIMEOUT_MS,
      }
    );
    if (result.ok) return result.stdout;
    if (result.code !== NOT_FOUND)
      log.warn('[Accounts] The keychain did not answer', { service, code: result.code });
    return null;
  };
}

export function parseStoredLogin(raw: string): StoredLogin | null {
  try {
    const oauth = (JSON.parse(raw) as { claudeAiOauth?: Record<string, unknown> }).claudeAiOauth;
    const accessToken = oauth?.accessToken;
    if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
    return {
      accessToken,
      plan: typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : null,
    };
  } catch {
    return null;
  }
}

function readCredentialsFile(dir: string) {
  try {
    return readFileSync(join(dir, '.credentials.json'), 'utf8');
  } catch {
    return null;
  }
}

export interface LoginQuery {
  configDir: string | null;
  env: Env;
  userHome: string;
  readSecret: SecretReader;
}

export async function readStoredLogin(query: LoginQuery): Promise<StoredLogin | null> {
  const configDir = query.configDir ?? selectConfiguredDir(query.env);
  const secret = await query.readSecret(resolveKeychainService(configDir), resolveKeychainAccount(query.env));
  const fromKeychain = secret === null ? null : parseStoredLogin(secret);
  if (fromKeychain) return fromKeychain;
  const file = readCredentialsFile(configDir ?? resolveSharedConfigDir(query.env, query.userHome));
  return file === null ? null : parseStoredLogin(file);
}
