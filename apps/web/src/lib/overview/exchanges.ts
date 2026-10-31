import {
  type FixReply,
  type Gate,
  type Iteration,
  type ReplyOutcome,
  resolveCurrentRound,
  selectOpenIteration,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatCount } from '@/lib/format/count.ts';

export type AnsweredIteration = Iteration & { reply: FixReply; repliedAt: number };

export type Exchange =
  | { kind: 'request'; key: string; at: number; iteration: AnsweredIteration }
  | { kind: 'plan'; key: string; at: number; version: number; summary: string | null; feedback: string };

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

export function selectShownReply(task: Task, gate: Gate | undefined): AnsweredIteration | null {
  if (gate?.type !== 'review' && gate?.type !== 'merge') return null;
  const last = task.iterations?.at(-1);
  if (!last || !isAnswered(last)) return null;
  return last.round === resolveCurrentRound(task).number ? last : null;
}

export function selectWorkingRequest(task: Task): Iteration | null {
  return task.stage === 'fixing' ? selectOpenIteration(task) : null;
}

export function listEarlierExchanges(task: Task, shownId: string | null): Exchange[] {
  const requests: Exchange[] = (task.iterations ?? [])
    .filter(isAnswered)
    .filter((iteration) => iteration.id !== shownId)
    .map((iteration) => ({ kind: 'request', key: iteration.id, at: iteration.repliedAt, iteration }));
  const revisions = [...(task.planHistory ?? []), ...(task.plan ? [task.plan] : [])];
  const plans: Exchange[] = revisions.flatMap((revision) =>
    revision.version > 1 && revision.feedback
      ? [
          {
            kind: 'plan' as const,
            key: `plan-${revision.version}`,
            at: revision.proposedAt,
            version: revision.version,
            summary: revision.changeSummary ?? null,
            feedback: revision.feedback,
          },
        ]
      : []
  );
  return [...requests, ...plans].sort((left, right) => right.at - left.at);
}

export function describeRequestText(iteration: Iteration) {
  const texts = iteration.requests.map((request) => request.text).filter(Boolean);
  const comments = iteration.requests.reduce((sum, request) => sum + request.comments, 0);
  const note = comments > 0 ? formatCount(comments, 'line comment', 'line comments') : null;
  if (texts.length === 0) return note ?? '';
  return [...texts, ...(note ? [`And ${note}.`] : [])].join('\n\n');
}

export function describeOutcomes(reply: FixReply) {
  return OUTCOME_ORDER.flatMap((outcome) => {
    const count = reply.points.filter((point) => point.outcome === outcome).length;
    return count > 0 ? [`${count} ${OUTCOME_COUNT[outcome]}`] : [];
  }).join(' · ');
}
