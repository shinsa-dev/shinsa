import { type Option, Schema } from 'effect';

export function isText(value: unknown): value is string {
  return typeof value === 'string';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const decodeJsonRecord = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
);

export function parseJsonRecord(text: string): Option.Option<Record<string, unknown>> {
  return decodeJsonRecord(text);
}
