import { Duration } from 'effect';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

export const SIGNATURE_WINDOW = Duration.minutes(5);

export const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export const SETTLED_REVOKE_CODES: ReadonlySet<string> = new Set([
  'invalid_auth',
  'token_revoked',
  'account_inactive',
  'not_authed',
]);
