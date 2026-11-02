import { BodyTooLarge, SignatureInvalid } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { CloudCrypto } from '../crypto/service.ts';
import { SIGNATURE_WINDOW, SLACK_EVENT_BODY_LIMIT_BYTES, TIMESTAMP_PATTERN } from './schema.ts';

export const readSignedBody = Effect.fn('readSignedBody')(function* (subject: string) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const crypto = yield* CloudCrypto;
  const body = yield* Effect.orDie(request.text);
  if (body.length > SLACK_EVENT_BODY_LIMIT_BYTES)
    return yield* new BodyTooLarge({ message: `The Slack ${subject} is over 1 MB.` });
  const timestamp = request.headers['x-slack-request-timestamp'] ?? '';
  const signature = request.headers['x-slack-signature'] ?? '';
  const seconds = (yield* Clock.currentTimeMillis) / 1000;
  const fresh =
    TIMESTAMP_PATTERN.test(timestamp) &&
    Math.abs(seconds - Number(timestamp)) <= Duration.toSeconds(SIGNATURE_WINDOW);
  if (!fresh || !(yield* crypto.isSlackSignature(timestamp, body, signature)))
    return yield* new SignatureInvalid({ message: 'The Slack signature does not match.' });
  return body;
});
