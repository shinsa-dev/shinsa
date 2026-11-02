import { BodyTooLarge, SignatureInvalid } from '@shinsa/core/remote/errors';
import { Clock, Duration, Effect, Option, Schema } from 'effect';
import { HttpServerRequest } from 'effect/http';
import { CloudCrypto } from '../crypto/crypto.ts';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

const SIGNATURE_WINDOW = Duration.minutes(5);

const TIMESTAMP_PATTERN = /^\d{1,12}$/;

export const SlackFields = Schema.Record(Schema.String, Schema.Unknown);

export type SlackFields = typeof SlackFields.Type;

const decodeFields = Schema.decodeUnknownOption(SlackFields);

export const decodeJsonFields = Schema.decodeUnknownOption(Schema.fromJsonString(SlackFields));

export function toFields(value: unknown): SlackFields | null {
  return Option.getOrNull(decodeFields(value));
}

export function readFields(fields: SlackFields, key: string): SlackFields {
  return toFields(fields[key]) ?? {};
}

export function readString(fields: SlackFields, key: string) {
  const value = fields[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

export function readText(fields: SlackFields, key: string) {
  const value = fields[key];
  return typeof value === 'string' ? value : '';
}

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
