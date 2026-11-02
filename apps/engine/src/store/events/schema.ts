import type { ShinsaEvent, ShinsaEventInput } from '@shinsa/core';
import { Schema } from 'effect';
import type { StoredPayloadMessages } from '../shared/schema.ts';

export const EventRow = Schema.Struct({
  seq: Schema.Int,
  at: Schema.Number,
  type: Schema.String,
  payload: Schema.String,
});
export type EventRow = typeof EventRow.Type;

export const SeqRange = Schema.Struct({ firstSeq: Schema.Int, lastSeq: Schema.Int });

export const EventRows = Schema.NonEmptyArray(EventRow);

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

export const EVENT_PAYLOAD_MESSAGES: StoredPayloadMessages = {
  notJson: 'The stored event is not valid JSON',
  mismatched: 'The stored event does not match its type.',
};
