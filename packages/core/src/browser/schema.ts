import { Option, Schema } from 'effect';
import { HandOverRecord, Required } from '../report/reading.ts';
import { resolveSignInSite } from './site.ts';

export const BROWSER_SIGN_IN_LIMITS = { url: 2_000, reason: 300 } as const;

export const SIGN_IN_URL_MESSAGE =
  '{path} must be the full http or https address of the page you want to see, not the sign-in page it sends you to.';

export interface BrowserSignInRequest {
  url: string;
  reason: string;
}

export const BrowserSignInInput = HandOverRecord({
  url: Required(BROWSER_SIGN_IN_LIMITS.url).check(
    Schema.makeFilter((url: string) => Option.isSome(resolveSignInSite(url)) || SIGN_IN_URL_MESSAGE)
  ),
  reason: Required(BROWSER_SIGN_IN_LIMITS.reason),
});

const SIGN_IN_CHECK_FAILURES = [
  'not_installed',
  'launch_failed',
  'profile_in_use',
  'signing_in',
  'timeout',
  'failed',
] as const;

export const SignInCheck = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('landed'), url: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('unchecked'), reason: Schema.Literals(SIGN_IN_CHECK_FAILURES) }),
]);
export type SignInCheck = typeof SignInCheck.Type;
export type SignInCheckFailure = (typeof SIGN_IN_CHECK_FAILURES)[number];
