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
import type { Engine } from '../runtime/engine.ts';
import type { DelegationOutcome } from './tools/orchestration.ts';

export interface Delivery {
  generation: number;
  items: string[];
  runIds: string[];
  text: string;
}

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
    const item = parseDeliveryItem(raw);
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

export function awaitDelegation(
  engine: Pick<Engine, 'state' | 'subscribe'>,
  childRunId: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<DelegationOutcome> {
  const now = resolveDelegationOutcome(engine.state, childRunId);
  if (now) return Promise.resolve(now);
  if (signal.aborted) return Promise.resolve('timeout');
  const { promise, resolve } = Promise.withResolvers<DelegationOutcome>();
  const timer = setTimeout(() => finish('timeout'), timeoutMs);
  const abort = () => finish('timeout');
  const unsubscribe = engine.subscribe((state) => {
    const outcome = resolveDelegationOutcome(state, childRunId);
    if (outcome) finish(outcome);
  });
  function finish(outcome: DelegationOutcome) {
    clearTimeout(timer);
    unsubscribe();
    signal.removeEventListener('abort', abort);
    resolve(outcome);
  }
  signal.addEventListener('abort', abort, { once: true });
  return promise;
}

export function resolveDelegatedReply(entries: ChatEntry[]) {
  for (const entry of [...entries].reverse()) {
    if (entry.type === 'user') return null;
    if (entry.type === 'agent' && !isSubagentEvent(entry) && entry.text.trim().length > 0) return entry.text;
  }
  return null;
}
