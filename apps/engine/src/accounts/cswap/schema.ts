import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { CommandOptions, CommandResult } from '../../shell/index.ts';
import type { CswapAccount } from '../schema.ts';

export class CswapListFailed extends Schema.TaggedError<CswapListFailed, { readonly brand: unique symbol }>()(
  'CswapListFailed',
  { message: Schema.String }
) {}

export interface CswapDefinition {
  readonly run: (
    command: string[],
    cwd: string,
    options: CommandOptions
  ) => Effect.Effect<CommandResult, CswapListFailed>;
  readonly which: (command: string) => Effect.Effect<string | null>;
  readonly now: Effect.Effect<number>;
  readonly home: string;
}

export interface CswapListing {
  readonly at: number;
  readonly accounts: CswapAccount[];
}

export interface CswapHandle {
  readonly list: Effect.Effect<CswapAccount[], CswapListFailed>;
}
