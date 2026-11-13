import { describe, expect, test } from 'bun:test';
import { Schema } from 'effect';
import * as failures from '../../src/remote/errors.ts';
import {
  NotFound,
  RateLimited,
  resolveRemoteFailureWire,
  SERVER_ERROR_MESSAGE,
  SignedOut,
  serializeRemoteFailure,
} from '../../src/remote/errors.ts';

const WIRE = [
  ['BodyInvalid', 'body_invalid', 400],
  ['BodyTooLarge', 'body_too_large', 413],
  ['ContentTypeInvalid', 'content_type_invalid', 415],
  ['Forbidden', 'forbidden', 403],
  ['NotFound', 'not_found', 404],
  ['MethodNotAllowed', 'method_not_allowed', 405],
  ['ServerError', 'server_error', 500],
  ['SignedOut', 'signed_out', 401],
  ['Revoked', 'revoked', 401],
  ['NotOwner', 'not_owner', 403],
  ['OwnerCannotLeave', 'owner_cannot_leave', 409],
  ['InviteInvalid', 'invite_invalid', 404],
  ['HandoffInvalid', 'handoff_invalid', 404],
  ['MembersFull', 'members_full', 409],
  ['GuestsFull', 'guests_full', 409],
  ['TeamsFull', 'teams_full', 409],
  ['InstancesFull', 'instances_full', 409],
  ['ServiceFull', 'service_full', 503],
  ['PairExpired', 'pair_expired', 404],
  ['PairClaimed', 'pair_claimed', 409],
  ['RateLimited', 'rate_limited', 429],
  ['SignInFailed', 'sign_in_failed', 400],
  ['InvalidRedirect', 'invalid_redirect', 400],
  ['InvalidChallenge', 'invalid_challenge', 400],
  ['UrlInvalid', 'url_invalid', 400],
  ['SignatureInvalid', 'signature_invalid', 401],
  ['SlackDenied', 'slack_denied', 400],
  ['SlackExpired', 'slack_expired', 400],
  ['SlackFailed', 'slack_failed', 502],
  ['SlackBlocksRefused', 'slack_blocks_refused', 422],
  ['SlackNotInstalled', 'slack_not_installed', 410],
  ['SlackNotLinked', 'slack_not_linked', 403],
  ['ThreadNotForwarded', 'thread_not_forwarded', 403],
  ['PostNotYours', 'post_not_yours', 403],
] as const;

describe('remote failures', () => {
  test('every failure the Worker answers has one class, its code and its status', () => {
    const classes = new Map(Object.entries(failures).filter(([name]) => /^[A-Z][a-z]/.test(name)));
    expect([...classes.keys()].sort()).toEqual(WIRE.map(([tag]) => tag).sort());
    for (const [tag, code, status] of WIRE) {
      const failure = classes.get(tag) as (typeof failures)[typeof tag];
      expect([failure.tag, failure.code, failure.status]).toEqual([tag, code, status]);
      const error = new failure({ message: 'Try again.' });
      expect(error._tag).toBe(tag);
      expect(error.message).toBe('Try again.');
      expect(error).toBeInstanceOf(Error);
    }
  });

  test('crosses the wire as { error: { code, message } } and comes back as the same class', () => {
    const wire = resolveRemoteFailureWire(NotFound);
    const error = new NotFound({ message: 'No such machine.' });
    expect(Schema.encodeSync(wire)(error)).toEqual({
      error: { code: 'not_found', message: 'No such machine.' },
    });
    const back = Schema.decodeUnknownSync(wire)({
      error: { code: 'not_found', message: 'No such machine.' },
    });
    expect(back).toBeInstanceOf(NotFound);
    expect(back.message).toBe('No such machine.');
  });

  test('a body with another code is not this failure, so two of one status stay apart', () => {
    const wire = resolveRemoteFailureWire(SignedOut);
    expect(Schema.decodeUnknownOption(wire)({ error: { code: 'revoked', message: 'x' } })._tag).toBe('None');
    expect(Schema.decodeUnknownOption(wire)({ error: { code: 'signed_out' } })._tag).toBe('None');
  });

  test('a failure becomes its status and body in one place, and anything else a plain server error', () => {
    expect(serializeRemoteFailure(new RateLimited({ message: 'Wait a minute.' }))).toEqual({
      status: 429,
      body: { error: { code: 'rate_limited', message: 'Wait a minute.' } },
    });
    expect(serializeRemoteFailure({ _tag: 'SqlError', message: 'no such table: sessions' })).toEqual({
      status: 500,
      body: { error: { code: 'server_error', message: SERVER_ERROR_MESSAGE } },
    });
  });
});
