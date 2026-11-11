import { AUTOPILOT_VERDICTS, type AutopilotJudgment } from '@shinsa/core';
import { type Effect, Schema } from 'effect';
import type { JsonSchema } from '../agents/providers/index.ts';

export const AUTOPILOT_JUDGE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: [...AUTOPILOT_VERDICTS] },
    reason: { type: 'string' },
    reply: { type: 'string' },
  },
  required: ['verdict', 'reason', 'reply'],
  additionalProperties: false,
};

export const AutopilotJudgeAnswer = Schema.Struct({
  verdict: Schema.Literals(AUTOPILOT_VERDICTS),
  reason: Schema.String,
  reply: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type AutopilotJudge = (system: string, prompt: string) => Effect.Effect<AutopilotJudgment | null>;
