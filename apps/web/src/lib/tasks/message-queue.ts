import { type Round, type Run, resolveCurrentRound, resolveTaskRounds, type Task } from '@shinsa/core';
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

export function describeQueue(task: Task, count: number) {
  const current = resolveCurrentRound(task).number;
  if (count === 1) return `Sends once round ${current} is finished.`;
  return `Sends once round ${current} is finished, one round at a time.`;
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
