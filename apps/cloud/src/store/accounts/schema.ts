import { RemoteUserId } from '@shinsa/core';
import { Schema } from 'effect';

export const SignInCode = Schema.Struct({
  userId: RemoteUserId,
  codeChallenge: Schema.String,
  expiresAt: Schema.Number,
});

export type SignInCode = typeof SignInCode.Type;
