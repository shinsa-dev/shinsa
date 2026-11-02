import { Result, Schema } from 'effect';
import { StoredJson, type StoredPayloadMessages, StoredRecord } from './schema.ts';

const decodeJson = Schema.decodeUnknownResult(StoredJson);

const decodeRecord = Schema.decodeUnknownResult(StoredRecord);

export function readStoredPayload(
  text: string,
  tag: string,
  expected: string,
  messages: StoredPayloadMessages
): Result.Result<Record<string, unknown>, string> {
  const json = decodeJson(text);
  if (Result.isFailure(json)) return Result.fail(`${messages.notJson}: ${json.failure.message}`);
  const record = decodeRecord(json.success);
  if (Result.isFailure(record) || record.success[tag] !== expected) return Result.fail(messages.mismatched);
  return Result.succeed(record.success);
}
