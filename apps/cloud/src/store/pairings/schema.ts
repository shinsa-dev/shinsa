import { ClaimCode } from '@shinsa/core';
import { Schema } from 'effect';
import { TokenHash } from '../../crypto/schema.ts';

export const NewPairing = Schema.Struct({
  claimCode: ClaimCode,
  pollSecretHash: TokenHash,
  name: Schema.String,
  publicKey: Schema.String,
  version: Schema.String,
  expiresAt: Schema.Number,
});

export type NewPairing = typeof NewPairing.Type;

export const Pairing = Schema.Struct({
  ...NewPairing.fields,
  credentials: Schema.NullOr(Schema.String),
  owner: Schema.NullOr(Schema.String),
});

export type Pairing = typeof Pairing.Type;
