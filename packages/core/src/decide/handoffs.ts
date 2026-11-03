import type { CommandOf } from '../commands/index.ts';
import { DomainError, isTaskSettled, resolveFirstName, type Task, type TaskGuest } from '../domain/index.ts';
import { isTeamTask } from '../share/teams.ts';
import type { Decider } from './decider.ts';

function assertHumanHandsOff(decider: Decider) {
  if (!decider.context.onBehalf) return;
  throw new DomainError({
    code: 'human_only',
    message:
      'Only the human hands a task to someone else. Tell them they can hand it off from the task in Shinsa.',
  });
}

function assertHandsOff(task: Task) {
  if (task.watchHome)
    throw new DomainError({ code: 'handoff_refused', message: 'An automation cannot be handed off.' });
  if (!isTaskSettled(task)) return;
  throw new DomainError({
    code: 'handoff_refused',
    message: 'This task is finished, so there is nothing left to hand off.',
  });
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
  if (handoff.teamId) return;
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
    throw new DomainError({
      code: 'handoff_gone',
      message: 'This link no longer hands off a task. Ask for a new one.',
    });
  if (handoff.guest?.id === command.guest.id) return;
  if (handoff.guest) {
    throw new DomainError({
      code: 'handoff_claimed',
      message: 'Someone else already opened this hand-off link. Ask the task’s owner for a new one.',
    });
  }
  decider.emit({ type: 'handoff.claimed', taskId: command.taskId, guest: command.guest });
}

export function leaveHandoff(decider: Decider, command: CommandOf<'handoff.leave'>) {
  const guest = decider.state.tasks[command.taskId]?.handoff?.guest;
  if (guest?.id !== command.guestId) return;
  decider.cancelEffects(command.taskId, ['handoff.link'], 'The task is no longer handed off.');
  decider.emit({ type: 'handoff.left', taskId: command.taskId, guest });
  decider.run({ kind: 'handoff.revoke', taskId: command.taskId, guestId: guest.id });
}

function assertNotHeld(task: Task, guest: TaskGuest) {
  const holder = task.handoff?.guest;
  if (!holder || holder.id === guest.id) return;
  throw new DomainError({
    code: 'handoff_claimed',
    message: `${resolveFirstName(holder)} has this task. Its owner takes it back first.`,
  });
}

function endHandoffLink(decider: Decider, task: Task) {
  if (!task.handoff || task.handoff.guest) return;
  decider.cancelEffects(task.id, ['handoff.link'], 'The task went to a teammate instead.');
  decider.run({ kind: 'handoff.revoke', taskId: task.id, guestId: null });
}

function isHeldByTeammate(task: Task, teamId: string, guest: TaskGuest) {
  return task.handoff?.teamId === teamId && task.handoff.guest?.id === guest.id;
}

export function handToTeammate(decider: Decider, command: CommandOf<'task.hand_to_teammate'>) {
  assertHumanHandsOff(decider);
  const task = decider.task(command.taskId);
  if (isHeldByTeammate(task, command.teamId, command.teammate)) return;
  assertHandsOff(task);
  if (!isTeamTask(decider.state, task, command.teamId))
    throw new DomainError({
      code: 'handoff_refused',
      message: 'This task is not in a project that team sees, so no one in it can take it.',
    });
  assertNotHeld(task, command.teammate);
  endHandoffLink(decider, task);
  decider.emit({
    type: 'task.handed_to_teammate',
    taskId: task.id,
    teamId: command.teamId,
    guest: command.teammate,
  });
}

function resolveTeammate(decider: Decider) {
  const actor = decider.context.guest;
  if (actor?.scope.kind === 'team') {
    const { scope: _scope, ...person } = actor;
    return { person, teamId: actor.scope.teamId };
  }
  throw new DomainError({
    code: 'handoff_refused',
    message: 'Only a teammate takes a task over, from the team’s tasks in Shinsa Cloud.',
  });
}

export function takeOverTask(decider: Decider, command: CommandOf<'task.take_over'>) {
  assertHumanHandsOff(decider);
  const { person, teamId } = resolveTeammate(decider);
  const task = decider.task(command.taskId);
  if (isHeldByTeammate(task, teamId, person)) return;
  assertHandsOff(task);
  assertNotHeld(task, person);
  endHandoffLink(decider, task);
  decider.emit({ type: 'task.taken_over', taskId: task.id, teamId, guest: person });
}

export function giveBackTask(decider: Decider, command: CommandOf<'task.give_back'>) {
  assertHumanHandsOff(decider);
  const { person } = resolveTeammate(decider);
  const handoff = decider.task(command.taskId).handoff;
  if (!(handoff?.teamId && handoff.guest?.id === person.id)) return;
  decider.emit({ type: 'handoff.left', taskId: command.taskId, guest: handoff.guest });
}
