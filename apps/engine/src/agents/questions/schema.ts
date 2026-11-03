import type { ChatEvent, DomainError, ShinsaCommand, ShinsaState } from '@shinsa/core';
import { Schema } from 'effect';
import type { Deferred, Effect } from 'effect';
import type { Engine } from '../../runtime/engine.ts';
import type { ActiveRun } from '../active/schema.ts';
import type { IdleReleaseDefinition, IdleReleaseOptions } from '../idle/schema.ts';
import type { ToolCallFailed } from '../tools/schema.ts';
import type { Transcripts } from '../transcripts/index.ts';

export type QuestionReply =
  | { readonly kind: 'answered'; readonly text: string }
  | { readonly kind: 'superseded'; readonly text: string }
  | { readonly kind: 'withdrawn' };

export const WITHDRAWN: QuestionReply = { kind: 'withdrawn' };

export interface ReplyWaitersHandle {
  readonly open: (id: string) => Effect.Effect<Deferred.Deferred<QuestionReply>>;
  readonly settle: (id: string, reply: QuestionReply) => Effect.Effect<boolean>;
  readonly take: (ids: readonly string[]) => Effect.Effect<readonly Deferred.Deferred<QuestionReply>[]>;
}

export interface QuestionsOptions {
  engine: Engine;
  transcripts: Transcripts;
  active: ReadonlyMap<string, ActiveRun>;
  execute: (runId: string, prompt: string) => Promise<void>;
  idle?: IdleReleaseOptions;
}

export class QuestionFailed extends Schema.TaggedError<QuestionFailed, { readonly brand: unique symbol }>()(
  'QuestionFailed',
  { message: Schema.String }
) {}

type QuestionAskFailure = ToolCallFailed | DomainError;

export type QuestionDispatch = (command: ShinsaCommand) => Effect.Effect<unknown, QuestionAskFailure>;

export interface QuestionsDefinition {
  readonly state: Effect.Effect<ShinsaState>;
  readonly active: ReadonlyMap<string, ActiveRun>;
  readonly execute: (runId: string, prompt: string) => Effect.Effect<void, QuestionFailed>;
  readonly dispatch: (command: ShinsaCommand, id: string) => Effect.Effect<void, QuestionFailed>;
  readonly record: (runId: string, entry: ChatEvent) => Effect.Effect<void>;
  readonly newId: Effect.Effect<string>;
  readonly idle: Omit<IdleReleaseDefinition, 'release'>;
}

export interface QuestionsHandle {
  readonly touch: (runId: string) => Effect.Effect<void>;
  readonly forget: (runId: string) => Effect.Effect<void>;
  readonly releaseWaiting: (runId: string) => Effect.Effect<void>;
  readonly ask: (
    runId: string,
    attemptId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    dispatch: QuestionDispatch
  ) => Effect.Effect<string, QuestionAskFailure>;
  readonly requestSecret: (
    runId: string,
    attemptId: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    dispatch: QuestionDispatch
  ) => Effect.Effect<string, QuestionAskFailure>;
  readonly resolve: (gateId: string) => Effect.Effect<void, QuestionFailed>;
  readonly replyToDelegate: (runId: string, questionId: string) => Effect.Effect<void, QuestionFailed>;
}
