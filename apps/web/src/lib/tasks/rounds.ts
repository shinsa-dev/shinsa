import {
  canChangeRoundShipping,
  formatRoundLabel,
  type PullRequest,
  type Round,
  type RoundPullRequest,
  type RoundShipping,
  type RoundStatus,
  type Run,
  resolveCurrentRound,
  resolveRoundProgress,
  resolveTaskProgress,
  resolveTaskRounds,
  selectShippingTarget,
  type Task,
  type TaskProgress,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { Tone } from '@/lib/format/tone.ts';

export interface RoundSection {
  round: Round;
  runs: Run[];
  current: boolean;
}

export interface ShippingItem {
  value: RoundShipping;
  label: string;
}

const ROUND_STATUS: Record<RoundStatus, { label: string; tone: Tone }> = {
  queued: { label: 'Waiting to start', tone: 'neutral' },
  active: { label: 'In progress', tone: 'blue' },
  shipped: { label: 'On its pull request', tone: 'green' },
  merged: { label: 'Merged', tone: 'purple' },
  finished: { label: 'Finished', tone: 'green' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
};

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

export function resolveRoundTrack(task: Task, round: Round): TaskProgress {
  return round.status === 'active' ? resolveTaskProgress(task) : resolveRoundProgress(round);
}

export function selectRoundPullRequest(task: Task, round: Round): RoundPullRequest | PullRequest | null {
  if (round.status === 'active') return task.pullRequest ?? round.pullRequest;
  return round.pullRequest;
}

export function listRoundSections(task: Task, runs: Run[]): RoundSection[] {
  const current = resolveCurrentRound(task).number;
  return resolveTaskRounds(task).map((round) => ({
    round,
    runs: runs.filter((run) => (run.round ?? 1) === round.number),
    current: round.number === current,
  }));
}

export function listEarlierRounds(task: Task) {
  const current = resolveCurrentRound(task).number;
  return resolveTaskRounds(task).filter((round) => round.number < current);
}

export function listWaitingRounds(task: Task) {
  return resolveTaskRounds(task).filter((round) => round.status === 'queued');
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

export function changeRoundShipping(task: Task, round: Round, shipping: RoundShipping) {
  return sendCommandWithToast(
    { type: 'round.ship', taskId: task.id, number: round.number, shipping },
    shipping === 'stacked'
      ? `Round ${round.number} ships as its own stacked pull request.`
      : `Round ${round.number} ships onto the open pull request.`
  );
}
