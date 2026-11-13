import {
  AUTOPILOT_SUGGESTION_VERDICTS,
  AUTOPILOT_VERDICTS,
  type AutopilotJudgment,
  type AutopilotSuggestionVerdict,
} from '@shinsa/core';
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

export const AUTOPILOT_WEIGH_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: [...AUTOPILOT_SUGGESTION_VERDICTS] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
};

export const AutopilotWeighAnswer = Schema.Struct({
  verdict: Schema.Literals(AUTOPILOT_SUGGESTION_VERDICTS),
  reason: Schema.String,
});

interface AutopilotWeighing {
  verdict: AutopilotSuggestionVerdict;
  reason: string;
}

export type AutopilotWeigher = (system: string, prompt: string) => Effect.Effect<AutopilotWeighing | null>;
