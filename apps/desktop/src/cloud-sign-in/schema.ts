import { REMOTE_TEXT_LIMITS } from '@shinsa/core';
import { Duration, Schema } from 'effect';
import { URL_SCHEME } from '../deep-links/schema.ts';

export const SIGNED_IN_HOST = 'signed-in';

export const SIGN_IN_REDIRECT = `${URL_SCHEME}://${SIGNED_IN_HOST}`;

export const SESSION_COOKIE_TTL = Duration.days(30);

export const VERIFIER_BYTES = 32;

export const SIGN_IN_ERROR_PARAM = 'sign_in_error';

export const SIGN_IN_FAILURE = { expired: 'sign_in_expired', failed: 'sign_in_failed' } as const;

const ERROR_CODE = /^[a-z][a-z_]{0,59}$/;

export const SignInReturn = Schema.Union([
  Schema.TaggedStruct('Code', {
    code: Schema.NonEmptyString.check(Schema.isMaxLength(REMOTE_TEXT_LIMITS.nativeCode)),
  }),
  Schema.TaggedStruct('Failed', { code: Schema.String.check(Schema.isPattern(ERROR_CODE)) }),
]);

export type SignInReturn = typeof SignInReturn.Type;

export class SignInExchangeFailed extends Schema.TaggedError<
  SignInExchangeFailed,
  { readonly brand: unique symbol }
>()('SignInExchangeFailed', { origin: Schema.String }) {}
