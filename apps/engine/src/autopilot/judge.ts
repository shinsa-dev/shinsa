import { Effect, Option, Schema } from 'effect';
import type { QuickJson } from '../agents/quick/index.ts';
import { listTaskReplies } from '../agents/reading/task.ts';
import type { Transcripts } from '../agents/transcripts/service.ts';
import {
  AUTOPILOT_JUDGE_SCHEMA,
  AUTOPILOT_WEIGH_SCHEMA,
  AutopilotJudgeAnswer,
  AutopilotWeighAnswer,
  type AutopilotJudge,
  type AutopilotReplyReader,
  type AutopilotWeigher,
} from './schema.ts';

export type { AutopilotJudge, AutopilotReplyReader, AutopilotWeigher } from './schema.ts';

const decodeAnswer = Schema.decodeUnknownOption(AutopilotJudgeAnswer);

const decodeWeighing = Schema.decodeUnknownOption(AutopilotWeighAnswer);

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

export function createAutopilotWeigher(ask: QuickJson): AutopilotWeigher {
  return (system, prompt) =>
    ask<unknown>(system, prompt, AUTOPILOT_WEIGH_SCHEMA).pipe(
      Effect.map((answer) =>
        Option.getOrNull(
          Option.map(decodeWeighing(answer), (decoded) => ({
            verdict: decoded.verdict,
            reason: decoded.reason,
          }))
        )
      )
    );
}

export function createAutopilotReplyReader(transcripts: Transcripts['Service']): AutopilotReplyReader {
  return (state, taskId) =>
    Effect.map(listTaskReplies(state, transcripts, taskId, ['agent']), (replies) =>
      replies.map((reply) => ({ at: reply.at, text: reply.text }))
    );
}
