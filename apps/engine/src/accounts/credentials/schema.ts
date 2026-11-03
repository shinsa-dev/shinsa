import { Schema } from 'effect';
import type { Effect } from 'effect';
import type { Env } from '../paths.ts';

export class SecretReadFailed extends Schema.TaggedError<
  SecretReadFailed,
  { readonly brand: unique symbol }
>()('SecretReadFailed', { message: Schema.String }) {}

export type SecretLookup = (
  service: string,
  account: string
) => Effect.Effect<string | null, SecretReadFailed>;

export interface StoredLoginQuery {
  readonly configDir: string | null;
  readonly env: Env;
  readonly userHome: string;
  readonly readSecret: SecretLookup;
}
