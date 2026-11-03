import { homedir } from 'node:os';
import { log } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import { parseStoredLogin } from './answers.ts';
import { AccountFolders } from './folders/service.ts';
import {
  type Env,
  resolveKeychainAccount,
  resolveKeychainService,
  resolveSharedConfigDir,
  selectConfiguredDir,
} from './paths.ts';
import { KEYCHAIN_COMMAND, KEYCHAIN_NOT_FOUND, KEYCHAIN_TIMEOUT_MS, type StoredLogin } from './schema.ts';

export { parseStoredLogin } from './answers.ts';
export type { StoredLogin } from './schema.ts';

export type SecretReader = (service: string, account: string) => Promise<string | null>;

export type SecretRunner = (
  command: string[],
  cwd: string,
  options: { timeoutMs: number }
) => Promise<CommandResult>;

export function createKeychainReader(
  run: SecretRunner = runCommand,
  platform = process.platform
): SecretReader {
  return async (service, account) => {
    if (platform !== 'darwin') return null;
    const result = await run(
      [KEYCHAIN_COMMAND, 'find-generic-password', '-a', account, '-s', service, '-w'],
      homedir(),
      {
        timeoutMs: KEYCHAIN_TIMEOUT_MS,
      }
    );
    if (result.ok) return result.stdout;
    if (result.code !== KEYCHAIN_NOT_FOUND)
      log.warn('[Accounts] The keychain did not answer', { service, code: result.code });
    return null;
  };
}

function readCredentialsFile(dir: string) {
  return edgeRuntime.runSync(AccountFolders.use((folders) => folders.readCredentials(dir)));
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
