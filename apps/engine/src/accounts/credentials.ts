import { homedir } from 'node:os';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import { type SecretLookup, SecretReadFailed } from './credentials/schema.ts';
import { readAccountLogin } from './credentials/service.ts';
import { readKeychainSecret } from './keychain/service.ts';
import type { Env } from './paths.ts';
import type { StoredLogin } from './schema.ts';

export { parseStoredLogin } from './answers.ts';
export type { StoredLogin } from './schema.ts';

export type SecretReader = (service: string, account: string) => Promise<string | null>;

export type SecretRunner = (
  command: string[],
  cwd: string,
  options: { timeoutMs: number }
) => Promise<CommandResult>;

export interface LoginQuery {
  configDir: string | null;
  env: Env;
  userHome: string;
  readSecret: SecretReader;
}

function failSecret(error: unknown) {
  return new SecretReadFailed({ message: describeError(error) });
}

export function createKeychainReader(
  run: SecretRunner = runCommand,
  platform: string = process.platform
): SecretReader {
  const definition = {
    run: (command: string[], cwd: string, options: { timeoutMs: number }) =>
      Effect.tryPromise({ try: () => run(command, cwd, options), catch: failSecret }),
    platform,
    home: homedir(),
  };
  return (service, account) => edgeRuntime.runPromise(readKeychainSecret(definition, service, account));
}

export function resolveSecretLookup(readSecret: SecretReader): SecretLookup {
  return (service, account) =>
    Effect.tryPromise({ try: () => readSecret(service, account), catch: failSecret });
}

export function readStoredLogin(query: LoginQuery): Promise<StoredLogin | null> {
  return edgeRuntime.runPromise(
    readAccountLogin({ ...query, readSecret: resolveSecretLookup(query.readSecret) })
  );
}
