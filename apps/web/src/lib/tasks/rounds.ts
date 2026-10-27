import {
  canChangeRoundShipping,
  describeList,
  formatRoundLabel,
  isDelegatedRun,
  lowerFirst,
  type PullRequest,
  type Round,
  type RoundOutcome,
  type RoundPullRequest,
  type RoundShipping,
  type RoundStatus,
  type Run,
  resolveCurrentRound,
  resolveTaskRounds,
  selectShippingTarget,
  type Task,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { endSentence, flattenWhitespace, formatCount } from '@/lib/format/count.ts';
import { formatSince } from '@/lib/format/time.ts';
import type { Tone } from '@/lib/format/tone.ts';

export interface RoundSection {
  round: Round;
  runs: Run[];
}

export interface ShippingItem {
  value: RoundShipping;
  label: string;
}

const ROUND_STATUS: Record<RoundStatus, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting to start', tone: 'neutral' },
  active: { label: 'In progress', tone: 'blue' },
  shipped: { label: 'On its pull request', tone: 'green' },
  merged: { label: 'Merged', tone: 'purple' },
  finished: { label: 'Finished', tone: 'green' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
};

export const ROUND_ICON: IconName = 'IconArrowsRepeatCircle';

export interface RoundFact {
  label: string;
  title: string;
  status: { label: string; tone: Tone };
  time: string;
}

export function hasRounds(task: Task) {
  return resolveTaskRounds(task).length > 1;
}

export function resolveRoundTag(task: Task) {
  return hasRounds(task) ? formatRoundLabel(resolveCurrentRound(task)) : null;
}

export function resolveHandleText(task: Task) {
  if (!task.handle) return null;
  const tag = resolveRoundTag(task);
  return tag ? `${task.handle} · ${tag}` : task.handle;
}

export function describeRoundStatus(round: Round) {
  return ROUND_STATUS[round.status];
}

export function resolveRoundCount(task: Task) {
  if (!hasRounds(task)) return null;
  return `Round ${resolveCurrentRound(task).number} of ${resolveTaskRounds(task).length}`;
}

const OPEN_ROUNDS: ReadonlySet<RoundStatus> = new Set<RoundStatus>(['waiting', 'active']);

export function describeRoundTime(round: Round, now = Date.now()) {
  if (round.endedAt !== null && !OPEN_ROUNDS.has(round.status)) {
    return formatSince(round.status === 'cancelled' ? 'Stopped' : 'Finished', round.endedAt, now);
  }
  if (round.startedAt !== null) return formatSince('Started', round.startedAt, now);
  return formatSince('Added', round.queuedAt, now);
}

export function resolveRoundFact(task: Task, now = Date.now()): RoundFact | null {
  const label = resolveRoundCount(task);
  if (!label) return null;
  const current = resolveCurrentRound(task);
  return {
    label,
    title: `Round ${current.number}: ${current.title}`,
    status: describeRoundStatus(current),
    time: describeRoundTime(current, now),
  };
}

export interface RoundDivider {
  label: string;
  title: string;
  heading: string;
  status: { label: string; tone: Tone };
  time: string;
}

export function resolveRoundDivider(round: Round, now = Date.now()): RoundDivider {
  const label = `Round ${round.number}`;
  return {
    label,
    title: round.title,
    heading: `${label}: ${round.title}`,
    status: describeRoundStatus(round),
    time: describeRoundTime(round, now),
  };
}

export function selectRoundRun(runs: Run[], round: Round) {
  return runs.find((run) => (run.round ?? 1) === round.number && !isDelegatedRun(run)) ?? null;
}

const SUMMARY_PHASES = 3;

function resolveFirstSentence(markdown: string) {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((block) =>
      flattenWhitespace(block.replace(/^\s*#+\s.*$/gm, '').replace(/^\s*(?:[-*>]|\d+\.)\s+/gm, ''))
    )
    .find((block) => block.length > 0);
  if (!paragraph) return null;
  return paragraph.split(/(?<=[.?!])\s+(?=[A-Z“"`*])/)[0] ?? paragraph;
}

function isSameText(left: string, right: string) {
  const plain = (text: string) =>
    text
      .replace(/[.?!…]+$/, '')
      .trim()
      .toLowerCase();
  return plain(left) === plain(right);
}

function describeRoundWork(round: Round, outcome: RoundOutcome, about: string) {
  const result = outcome.result ? resolveFirstSentence(outcome.result) : null;
  if (result) return result;
  if (
    outcome.headline &&
    !isSameText(outcome.headline, about) &&
    !isSameText(outcome.headline, round.title)
  ) {
    return outcome.headline;
  }
  const phases = outcome.phases;
  if (phases.length === 0) return null;
  if (phases.length > SUMMARY_PHASES) return `It finished ${formatCount(phases.length, 'phase', 'phases')}.`;
  return `It finished ${formatCount(phases.length, 'phase', 'phases')}: ${describeList(phases.map(lowerFirst))}.`;
}

function describeRoundEnd(round: Round) {
  if (round.status === 'cancelled') return 'It stopped before it finished.';
  const pullRequest = round.pullRequest;
  if (!pullRequest) return null;
  if (round.status === 'merged' || pullRequest.state === 'merged') {
    return `Merged in pull request #${pullRequest.number}.`;
  }
  return `Shipped on pull request #${pullRequest.number}.`;
}

export function resolveRoundSummary(round: Round) {
  if (round.status === 'waiting') {
    return `${endSentence(round.why ?? round.title)} It starts once round ${round.number - 1} is finished.`;
  }
  const outcome = round.outcome;
  const about = outcome?.goal ?? round.title;
  const work = outcome ? describeRoundWork(round, outcome, about) : null;
  return [about, work, describeRoundEnd(round)]
    .flatMap((sentence) => (sentence ? [endSentence(sentence)] : []))
    .join(' ');
}

export function selectRoundPullRequest(task: Task, round: Round): RoundPullRequest | PullRequest | null {
  if (round.status === 'active') return task.pullRequest ?? round.pullRequest;
  return round.pullRequest;
}

export function listRoundSections(task: Task, runs: Run[]): RoundSection[] {
  return resolveTaskRounds(task).map((round) => ({
    round,
    runs: runs.filter((run) => (run.round ?? 1) === round.number),
  }));
}

export function listEarlierRounds(task: Task) {
  const current = resolveCurrentRound(task).number;
  return resolveTaskRounds(task).filter((round) => round.number < current);
}

export function listWaitingRounds(task: Task) {
  return resolveTaskRounds(task).filter((round) => round.status === 'waiting');
}

export function listShippingItems(task: Task, round: Round): ShippingItem[] | null {
  if (!canChangeRoundShipping(task, round)) return null;
  const target = selectShippingTarget(task, round);
  if (!target) return null;
  return [
    { value: 'onto_pull_request', label: `Onto #${target.number}` },
    { value: 'stacked', label: 'As a stacked pull request' },
  ];
}

const SHIPPING_TOASTS: Record<RoundShipping, string> = {
  stacked: 'ships as its own stacked pull request',
  onto_pull_request: 'ships onto the open pull request',
};

export function changeRoundShipping(task: Task, round: Round, shipping: RoundShipping) {
  return sendCommandWithToast(
    { type: 'round.ship', taskId: task.id, number: round.number, shipping },
    `Round ${round.number} ${SHIPPING_TOASTS[shipping]}.`
  );
}
