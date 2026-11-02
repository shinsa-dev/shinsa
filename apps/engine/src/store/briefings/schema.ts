import type { StoredBriefing } from '@shinsa/core';
import { Schema } from 'effect';

export const BriefingRow = Schema.Struct({ payload: Schema.String });

export const StoredBriefingPayload = Schema.fromJsonString(
  Schema.Struct({
    text: Schema.String,
    at: Schema.Number,
    projectId: Schema.optionalKey(Schema.Unknown),
    briefing: Schema.optionalKey(Schema.Unknown),
  })
);

export interface ProjectBriefing {
  projectId: string | null;
  stored: StoredBriefing;
}
