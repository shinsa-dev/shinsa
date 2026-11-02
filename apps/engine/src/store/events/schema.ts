import type { ShinsaEvent, ShinsaEventInput } from '@shinsa/core';
import { Schema } from 'effect';

export const EventRow = Schema.Struct({
  seq: Schema.Int,
  at: Schema.Number,
  type: Schema.String,
  payload: Schema.String,
});
export type EventRow = typeof EventRow.Type;

export const SeqRange = Schema.Struct({ firstSeq: Schema.Int, lastSeq: Schema.Int });

export const StoredJson = Schema.fromJsonString(Schema.Unknown);

export const StoredEventPayload = Schema.StructWithRest(Schema.Struct({ type: Schema.String }), [
  Schema.Record(Schema.String, Schema.Unknown),
]);

export interface UnreadableEvent {
  seq: number;
  type: string;
  error: string;
}

export interface EventRead {
  events: ShinsaEvent[];
  unreadable: UnreadableEvent[];
  lastSeq: number;
}

export interface EventAppend {
  events: ShinsaEventInput[];
  fromSeq: number;
  at: number;
}

export const NOT_JSON_EVENT = 'The stored event is not valid JSON';

export const MISMATCHED_EVENT = 'The stored event does not match its type.';
