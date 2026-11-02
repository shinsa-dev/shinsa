import { Schema } from 'effect';

export const TokenHash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)).pipe(
  Schema.brand('TokenHash')
);

export type TokenHash = typeof TokenHash.Type;

export class CryptoFailed extends Schema.TaggedError<CryptoFailed, { readonly brand: unique symbol }>()('CryptoFailed', {
  message: Schema.String,
}) {}

const CONFUSABLE = new Set(['I', 'O', '0', '1']);

export const CLAIM_ALPHABET = [
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...'23456789',
]
  .filter((character) => !CONFUSABLE.has(character))
  .join('');

export const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const CLAIM_CODE_LENGTH = 8;

export const ID_LENGTH = 12;

export const DEFAULT_TOKEN_BYTES = 32;

export const SEALED_IV_BYTES = 12;

export const TOKEN_KEY_BYTES = 32;
