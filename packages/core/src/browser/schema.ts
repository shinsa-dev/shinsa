import { Schema } from 'effect';
import { HandOverRecord, Required } from '../report/reading.ts';
import { resolveSignInSite } from './site.ts';

export const BROWSER_SIGN_IN_LIMITS = { url: 2_000, reason: 300 } as const;

export const SIGN_IN_URL_MESSAGE =
  '{path} must be the full http or https address of the page that asks you to sign in.';

export interface BrowserSignInRequest {
  url: string;
  reason: string;
}

export const BrowserSignInInput = HandOverRecord({
  url: Required(BROWSER_SIGN_IN_LIMITS.url).check(
    Schema.makeFilter((url: string) => resolveSignInSite(url) !== null || SIGN_IN_URL_MESSAGE)
  ),
  reason: Required(BROWSER_SIGN_IN_LIMITS.reason),
});
