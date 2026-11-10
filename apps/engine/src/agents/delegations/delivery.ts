import {
  type ChatEntry,
  type DeliveredQuestion,
  type DeliveredResult,
  describeDelegateRole,
  isDelegatedRun,
  isSubagentEvent,
  parseDeliveryItem,
  type Run,
  resolveCohort,
  resolveDelegationStatus,
  resolveDeliveryPrompt,
  type ShinsaState,
} from '@shinsa/core';
import { Deferred, type Duration, Effect, Option } from 'effect';
import { EngineCore } from '../../runtime/engine/service.ts';
import { awaitAbort } from '../../shell/abort.ts';
import type { DelegationOutcome } from '../tools/orchestration/schema.ts';
import { type Delivery } from './schema.ts';

function selectChild(state: ShinsaState, parent: Run, runId: string) {
  const child = state.runs[runId];
  return child && isDelegatedRun(child) && child.delegation.parentRunId === parent.id ? child : null;
}

export function resolveDelivery(state: ShinsaState, parent: Run): Delivery | null {
  const claim = resolveCohort(parent).claim;
  if (!claim) return null;
  const results: DeliveredResult[] = [];
  const questions: DeliveredQuestion[] = [];
  const messages: string[] = [];
  for (const raw of claim.items) {
    const item = Option.getOrNull(parseDeliveryItem(raw));
    if (item?.kind === 'message') {
      const message = resolveCohort(parent).messages.find((candidate) => candidate.id === item.messageId);
      if (message) messages.push(message.text);
      continue;
    }
    const child = item ? selectChild(state, parent, item.runId) : null;
    if (!child) continue;
    if (item?.kind === 'result' && child.endedAt !== null && child.delegation.delivery === 'none') {
      results.push({
        runId: child.id,
        title: child.delegation.title,
        role: describeDelegateRole(child.role),
        status: resolveDelegationStatus(child),
        result: child.summary,
      });
    }
    const question = child.delegation.question;
    if (item?.kind === 'question' && child.endedAt === null && question?.answer === null) {
      questions.push({
        runId: child.id,
        title: child.delegation.title,
        question: question.question,
        context: question.context,
        choices: question.choices,
      });
    }
  }
  const runIds = [...results, ...questions].map((entry) => entry.runId);
  const text = resolveDeliveryPrompt({ results, questions, messages }, parent);
  return { generation: claim.generation, items: claim.items, runIds, text };
}

function resolveDelegationOutcome(state: ShinsaState, childRunId: string): DelegationOutcome | null {
  const child = state.runs[childRunId];
  if (!child || child.endedAt !== null) return 'settled';
  const question = child.delegation?.question;
  if (question && question.answer === null && !question.delivered) return 'question';
  return null;
}

export const awaitDelegation = Effect.fn('Delegations.await')(function* (
  childRunId: string,
  timeout: Duration.Duration,
  signal: AbortSignal
) {
  const engine = yield* EngineCore;
  const outcome = yield* Deferred.make<DelegationOutcome>();
  yield* engine.observe((state) => {
    const settled = resolveDelegationOutcome(state, childRunId);
    if (settled) Deferred.doneUnsafe(outcome, Effect.succeed(settled));
  });
  const now = resolveDelegationOutcome(yield* engine.state, childRunId);
  if (now) return now;
  const timedOut: DelegationOutcome = 'timeout';
  return yield* Effect.raceFirst(Deferred.await(outcome), Effect.as(awaitAbort(signal), timedOut)).pipe(
    Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.succeed(timedOut) })
  );
}, Effect.scoped);

export function resolveDelegatedReply(entries: ChatEntry[]) {
  for (const entry of [...entries].reverse()) {
    if (entry.type === 'user') return null;
    if (entry.type === 'agent' && !isSubagentEvent(entry) && entry.text.trim().length > 0) return entry.text;
  }
  return null;
}
