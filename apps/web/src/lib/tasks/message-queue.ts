import {
  type Round,
  type RoundRelease,
  type Run,
  resolveCurrentRound,
  resolveRoundRelease,
  resolveTaskRounds,
  type ShinsaState,
  type Task,
} from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export interface QueuedMessage {
  number: number;
  text: string;
}

export function listQueuedMessages(task: Task): QueuedMessage[] {
  return resolveTaskRounds(task)
    .filter((round) => round.status === 'waiting')
    .map((round) => ({ number: round.number, text: round.request }));
}

const RELEASE_WORDS: Record<RoundRelease, (round: number) => string> = {
  now: (round) => `once round ${round} is finished`,
  finish: (round) => `once round ${round} is finished`,
  approve: (round) => `after you approve round ${round}`,
  approve_and_merge: (round) => `after you approve and merge round ${round}`,
  merge: (round) => `after you merge round ${round}`,
};

export function describeRoundRelease(state: ShinsaState, task: Task, round: Round) {
  const current = resolveCurrentRound(task).number;
  const next = resolveTaskRounds(task).find((candidate) => candidate.status === 'waiting');
  if (round.number !== next?.number) return `once round ${round.number - 1} is finished`;
  return RELEASE_WORDS[resolveRoundRelease(state, task, round.pipeline)](current);
}

export function describeQueue(state: ShinsaState, task: Task) {
  const waiting = resolveTaskRounds(task).filter((round) => round.status === 'waiting');
  const [next] = waiting;
  if (!next) return '';
  const when = describeRoundRelease(state, task, next);
  return waiting.length === 1 ? `Sends ${when}.` : `Sends ${when}, one round at a time.`;
}

export function isRoundDelivering(round: Round, runs: Run[]) {
  return round.number > 1 && round.status === 'active' && runs.every((run) => run.status === 'queued');
}

export function updateQueuedMessage(task: Task, message: QueuedMessage, text: string) {
  return sendCommandWithToast(
    { type: 'round.update', taskId: task.id, number: message.number, request: text },
    'Changed the queued message.'
  );
}

export function removeQueuedMessage(task: Task, message: QueuedMessage) {
  return sendCommandWithToast(
    { type: 'round.remove', taskId: task.id, number: message.number },
    'Removed the queued message.'
  );
}

export function sendQueuedMessage(task: Task, message: QueuedMessage) {
  return sendCommandWithToast(
    { type: 'round.send', taskId: task.id, number: message.number },
    `Sent to round ${resolveCurrentRound(task).number}.`
  );
}
