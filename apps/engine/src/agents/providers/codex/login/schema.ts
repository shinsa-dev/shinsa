import type { ProviderLogin } from '@shinsa/core';
import type { Effect } from 'effect';
import type { CommandResult } from '../../../../shell/schema.ts';
import type { CodexExecutable } from '../executable/schema.ts';

export type LoginPatch = Partial<ProviderLogin> & Pick<ProviderLogin, 'status'>;

export interface CodexLoginDefinition {
  readonly executable: Effect.Effect<CodexExecutable>;
  readonly status: (path: string) => Effect.Effect<CommandResult>;
}

export const SIGN_IN = 'Run `codex login` in a terminal, then refresh.';

export const UNKNOWN_SYNTAX = /unrecognized subcommand|unexpected argument|unknown command/i;
