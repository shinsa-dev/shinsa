import type { Effect } from 'effect';
import type { CommandResult } from '../../shell/index.ts';
import type { SecretReadFailed } from '../credentials/schema.ts';

export interface KeychainDefinition {
  readonly run: (
    command: string[],
    cwd: string,
    options: { timeoutMs: number }
  ) => Effect.Effect<CommandResult, SecretReadFailed>;
  readonly platform: string;
  readonly home: string;
}
