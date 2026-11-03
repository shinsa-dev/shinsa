import type { AccountImport, DomainError } from '@shinsa/core';
import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { CswapHandle, CswapListFailed } from '../cswap/schema.ts';

export class ImportSignInFailed extends Schema.TaggedError<
  ImportSignInFailed,
  { readonly brand: unique symbol }
>()('ImportSignInFailed', { message: Schema.String }) {}

export interface ImportsDefinition {
  readonly listKnownEmails: Effect.Effect<string[]>;
  readonly hasAccount: (email: string) => Effect.Effect<boolean>;
  readonly cswap: CswapHandle;
  readonly signIn: (email: string) => Effect.Effect<void, DomainError | ImportSignInFailed>;
  readonly changed: Effect.Effect<void>;
}

export interface ImportsHandle {
  readonly list: Effect.Effect<AccountImport[]>;
  readonly sync: Effect.Effect<void, CswapListFailed>;
  readonly importAccount: (
    origin: unknown,
    email: unknown
  ) => Effect.Effect<void, DomainError | ImportSignInFailed>;
}
