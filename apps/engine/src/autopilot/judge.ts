import { Effect, Option, Schema } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { AUTOPILOT_JUDGE_SCHEMA, AutopilotJudgeAnswer, type AutopilotJudge } from './schema.ts';

export type { AutopilotJudge } from './schema.ts';

const decodeAnswer = Schema.decodeUnknownOption(AutopilotJudgeAnswer);

export function createAutopilotJudge(ask: QuickJson): AutopilotJudge {
  return (system, prompt) =>
    ask<unknown>(system, prompt, AUTOPILOT_JUDGE_SCHEMA).pipe(
      Effect.map((answer) =>
        Option.getOrNull(
          Option.map(decodeAnswer(answer), (decoded) => ({
            verdict: decoded.verdict,
            reason: decoded.reason,
            reply: decoded.reply ?? null,
          }))
        )
      )
    );
}
