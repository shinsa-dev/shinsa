import { readFileSync, writeFileSync } from 'node:fs';
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
  refreshToken: string | null;
  expiresAt: number | null;
  plan: string | null;
}

export type SecretReader = (service: string, account: string) => Promise<string | null>;

export type SecretWriter = (service: string, account: string, value: string) => Promise<boolean>;

export type SecretRunner = (
  command: string[],
  cwd: string,
  options: { timeoutMs: number; input?: string }
) => Promise<CommandResult>;

const SECURITY = '/usr/bin/security';

const KEYCHAIN_TIMEOUT_MS = 5_000;

const NOT_FOUND = 44;

const STDIN_LINE_LIMIT = 4096 - 64;

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

function quoteForSecurity(value: string) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function createKeychainWriter(
  run: SecretRunner = runCommand,
  platform = process.platform
): SecretWriter {
  return async (service, account, value) => {
    if (platform !== 'darwin') return false;
    const hex = Buffer.from(value, 'utf8').toString('hex');
    const line = `add-generic-password -U -a ${quoteForSecurity(account)} -s ${quoteForSecurity(service)} -X ${quoteForSecurity(hex)}\n`;
    const command =
      line.length <= STDIN_LINE_LIMIT
        ? { argv: [SECURITY, '-i'], input: line }
        : { argv: [SECURITY, 'add-generic-password', '-U', '-a', account, '-s', service, '-X', hex] };
    const result = await run(command.argv, homedir(), {
      timeoutMs: KEYCHAIN_TIMEOUT_MS,
      ...(command.input ? { input: command.input } : {}),
    });
    if (!result.ok) log.warn('[Accounts] The keychain did not take a login', { service, code: result.code });
    return result.ok;
  };
}

function parseSecretObject(raw: string | null): Record<string, unknown> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function parseStoredLogin(raw: string): StoredLogin | null {
  const oauth = parseSecretObject(raw).claudeAiOauth as Record<string, unknown> | undefined;
  const accessToken = oauth?.accessToken;
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;
  return {
    accessToken,
    refreshToken: typeof oauth?.refreshToken === 'string' ? oauth.refreshToken : null,
    expiresAt: typeof oauth?.expiresAt === 'number' ? oauth.expiresAt : null,
    plan: typeof oauth?.subscriptionType === 'string' ? oauth.subscriptionType : null,
  };
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

export interface LoginWrite {
  configDir: string;
  env: Env;
  readSecret: SecretReader;
  writeSecret: SecretWriter;
}

function mergeLogin(raw: string | null, oauth: Record<string, unknown>) {
  return JSON.stringify({ ...parseSecretObject(raw), claudeAiOauth: oauth });
}

export async function writeStoredLogin(query: LoginWrite, oauth: Record<string, unknown>) {
  const service = resolveKeychainService(query.configDir);
  const account = resolveKeychainAccount(query.env);
  const stored = await query.readSecret(service, account);
  if (await query.writeSecret(service, account, mergeLogin(stored, oauth))) return;
  writeFileSync(
    join(query.configDir, '.credentials.json'),
    mergeLogin(readCredentialsFile(query.configDir), oauth),
    { mode: 0o600 }
  );
}
