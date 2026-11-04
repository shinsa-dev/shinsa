import type { DomainError, ShinsaCommand } from '@shinsa/core';
import type { Deferred, Effect } from 'effect';
import type { ToolCallFailed } from '../tools/schema.ts';

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

type QuestionAskFailure = ToolCallFailed | DomainError;

export type QuestionDispatch = (command: ShinsaCommand) => Effect.Effect<unknown, QuestionAskFailure>;
