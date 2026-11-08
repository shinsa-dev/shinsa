import type { StoredBriefing } from '@shinsa/core';
import { Schema } from 'effect';

export const BriefingRow = Schema.Struct({ project: Schema.String, payload: Schema.String });

export const StoredBriefingPayload = Schema.fromJsonString(
  Schema.Struct({
    text: Schema.String,
    at: Schema.Number,
    briefing: Schema.optionalKey(Schema.Unknown),
  })
);

export interface KeyedBriefing {
  key: string;
  stored: StoredBriefing;
}
