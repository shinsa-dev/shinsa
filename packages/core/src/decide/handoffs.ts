import type { CommandOf } from '../commands/index.ts';
import { DomainError, isTaskSettled, type Task } from '../domain/index.ts';
import type { Decider } from './decider.ts';

function assertHumanHandsOff(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError(
    'human_only',
    'Only the human hands a task to someone else. Tell them they can hand it off from the task in Shinsa.'
  );
}

function assertHandsOff(task: Task) {
  if (task.watchHome) throw new DomainError('handoff_refused', 'An automation cannot be handed off.');
  if (!isTaskSettled(task)) return;
  throw new DomainError('handoff_refused', 'This task is finished, so there is nothing left to hand off.');
}

export function handOffTask(decider: Decider, command: CommandOf<'task.hand_off'>) {
  assertHumanHandsOff(decider);
  const task = decider.task(command.taskId);
  if (task.handoff) {
    if (task.handoff.failure && !task.handoff.guest) decider.run({ kind: 'handoff.link', taskId: task.id });
    return;
  }
  assertHandsOff(task);
  decider.emit({ type: 'task.handed_off', taskId: task.id });
  decider.run({ kind: 'handoff.link', taskId: task.id });
}

export function removeHandoff(decider: Decider, command: CommandOf<'handoff.remove'>) {
  assertHumanHandsOff(decider);
  const handoff = decider.task(command.taskId).handoff;
  if (!handoff) return;
  decider.cancelEffects(command.taskId, ['handoff.link'], 'The task is no longer handed off.');
  decider.emit({ type: 'handoff.removed', taskId: command.taskId, guest: handoff.guest });
  decider.run({ kind: 'handoff.revoke', taskId: command.taskId, guestId: handoff.guest?.id ?? null });
}

export function recordHandoff(decider: Decider, command: CommandOf<'handoff.record'>) {
  const handoff = decider.state.tasks[command.taskId]?.handoff;
  if (!handoff || handoff.guest || (handoff.url === command.url && !handoff.failure)) return;
  decider.emit({ type: 'handoff.recorded', taskId: command.taskId, url: command.url });
}

export function failHandoff(decider: Decider, command: CommandOf<'handoff.fail'>) {
  const handoff = decider.state.tasks[command.taskId]?.handoff;
  if (!handoff || handoff.guest || handoff.failure === command.detail) return;
  decider.emit({ type: 'handoff.failed', taskId: command.taskId, detail: command.detail });
}

export function claimHandoff(decider: Decider, command: CommandOf<'handoff.claim'>) {
  const handoff = decider.state.tasks[command.taskId]?.handoff;
  if (!handoff)
    throw new DomainError('handoff_gone', 'This link no longer hands off a task. Ask for a new one.');
  if (handoff.guest?.id === command.guest.id) return;
  if (handoff.guest) {
    throw new DomainError('handoff_claimed', 'Someone else already took this task over. Ask for a new link.');
  }
  decider.emit({ type: 'handoff.claimed', taskId: command.taskId, guest: command.guest });
}
