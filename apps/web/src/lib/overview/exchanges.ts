import {
  type AgentReply,
  capitalise,
  type Gate,
  type Iteration,
  type ReplyOutcome,
  resolveCurrentRound,
  type ShinsaState,
  selectOpenIteration,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatCount } from '@/lib/format/count.ts';
import { describeOwnerInSentence, describeOwnerPossessive } from '@/lib/share/page.ts';

export type AnsweredIteration = Iteration & { reply: AgentReply; repliedAt: number };

export const REPLY_OUTCOME: Record<
  Exclude<ReplyOutcome, 'done'>,
  { icon: IconName; label: string; className: string }
> = {
  answered: { icon: 'IconBubbleText', label: 'Answered', className: 'text-primary-text' },
  not_changed: { icon: 'IconCircleMinus', label: 'Not changed', className: 'text-fg-2' },
};

const OUTCOME_ORDER: readonly ReplyOutcome[] = ['done', 'answered', 'not_changed'];

const OUTCOME_COUNT: Record<ReplyOutcome, string> = {
  done: 'done',
  answered: 'answered',
  not_changed: 'not changed',
};

function isAnswered(iteration: Iteration): iteration is AnsweredIteration {
  return iteration.reply !== null && iteration.repliedAt !== null;
}

type ReplyMatch = (iteration: AnsweredIteration, state: ShinsaState, task: Task) => boolean;

function isPlanReply(iteration: AnsweredIteration, state: ShinsaState) {
  return iteration.runId !== null && state.runs[iteration.runId]?.purpose === 'plan';
}

function isResultReply(iteration: AnsweredIteration, _state: ShinsaState, task: Task) {
  return iteration.runId !== null && iteration.runId === task.result?.runId;
}

function isWorkReply(iteration: AnsweredIteration, state: ShinsaState) {
  return !isPlanReply(iteration, state);
}

const REPLY_SHOWN_AT: Partial<Record<Gate['type'], ReplyMatch>> = {
  plan: isPlanReply,
  review: isWorkReply,
  merge: isWorkReply,
  proposal: isResultReply,
  result: isResultReply,
};

export function selectShownReply(
  state: ShinsaState,
  task: Task,
  gate: Gate | undefined
): AnsweredIteration | null {
  const last = task.iterations?.at(-1);
  if (!last || !isAnswered(last) || last.round !== resolveCurrentRound(task).number) return null;
  const shows = gate ? REPLY_SHOWN_AT[gate.type] : isResultReply;
  return shows?.(last, state, task) ? last : null;
}

export function selectWorkingRequest(task: Task): Iteration | null {
  return task.stage === 'fixing' ? selectOpenIteration(task) : null;
}

export function listEarlierReplies(task: Task, shownId: string | null): AnsweredIteration[] {
  return (task.iterations ?? [])
    .filter(isAnswered)
    .filter((iteration) => iteration.id !== shownId)
    .sort((left, right) => right.repliedAt - left.repliedAt);
}

export function describeRequestText(iteration: Iteration) {
  const texts = iteration.requests.map((request) => request.text).filter(Boolean);
  const comments = iteration.requests.reduce((sum, request) => sum + request.comments, 0);
  const note = comments > 0 ? formatCount(comments, 'line comment', 'line comments') : null;
  if (texts.length === 0) return note ?? '';
  const said = texts.join('\n\n');
  return note ? `${said}\nAnd ${note}.` : said;
}

export function describeOutcomes(reply: AgentReply) {
  return OUTCOME_ORDER.flatMap((outcome) => {
    const count = reply.points.filter((point) => point.outcome === outcome).length;
    return count > 0 ? [`${count} ${OUTCOME_COUNT[outcome]}`] : [];
  }).join(' · ');
}

export function describeSentLabel(owner: string | null = null) {
  return `What ${owner === null ? 'you' : describeOwnerInSentence(owner)} sent`;
}

export function describeRequestLabel(owner: string | null = null) {
  return `${capitalise(describeOwnerPossessive(owner))} request`;
}
