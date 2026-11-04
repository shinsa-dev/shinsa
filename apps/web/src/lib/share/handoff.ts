import {
  isHeldBy,
  isTaskSettled,
  isTeamTask,
  type RemoteSnapshot,
  type RemoteUser,
  type ShinsaState,
  type Task,
  type TaskGuest,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { useSyncExternalStore } from 'react';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import type { MachineView } from '@/lib/connection/socket.ts';
import { type Mention, resolveFirstName } from '@/lib/remote/users.ts';
import { createSignal } from '@/lib/signal.ts';

export const HANDOFF_TITLE = 'Hand off';

export const HANDOFF_ICON: IconName = 'IconHandshake';

export const HANDOFF_DESCRIPTION =
  'The first GitHub account to open the link works on this task from their own Shinsa and reaches nothing else on this machine. It stays yours: it runs here, you see everything they do, and you can take it back at any time.';

export const HANDOFF_HELD_DESCRIPTION =
  'It stays yours: it runs here, you see everything they do, and Remove takes it back at once.';

export const HANDOFF_COPY = 'Copy hand-off link';

export const HANDOFF_REMOVE = 'Remove';

export const HANDOFF_REMOVE_DESCRIPTION =
  'They lose this task at once. To hand it to someone else, hand it off again for a new link.';

export type HandoffView =
  | { kind: 'off' }
  | { kind: 'linking' }
  | { kind: 'failed'; message: string }
  | { kind: 'ready'; url: string }
  | { kind: 'claimed'; guest: TaskGuest; at: number };

const handoffSignal = createSignal();

let removing: string | null = null;

export function openHandoffRemoveConfirm(taskId: string) {
  removing = taskId;
  handoffSignal.publish();
}

export function closeHandoffRemoveConfirm() {
  removing = null;
  handoffSignal.publish();
}

export function useHandoffRemoveConfirm() {
  return useSyncExternalStore(handoffSignal.subscribe, () => removing);
}

export function canHandOff(task: Task) {
  if (task.handoff) return true;
  return !task.watchHome && !isTaskSettled(task);
}

export function resolveHandoffView(task: Task): HandoffView {
  const handoff = task.handoff;
  if (!handoff) return { kind: 'off' };
  if (handoff.guest) return { kind: 'claimed', guest: handoff.guest, at: handoff.claimedAt ?? handoff.at };
  if (handoff.failure) return { kind: 'failed', message: handoff.failure };
  if (handoff.url) return { kind: 'ready', url: handoff.url };
  return { kind: 'linking' };
}

export function describeHandoffClaim(guest: TaskGuest): Mention {
  return [{ user: guest }, ' is working on this task'];
}

export function isTaskHandedOff(task: Task) {
  const handoff = task.handoff;
  return Boolean(handoff && (handoff.guest || (handoff.url && !handoff.failure)));
}

type TaskMachine = Pick<MachineView, 'handedBy' | 'teammate'> | null;

function isHeldByViewer(task: Task, machine: TaskMachine) {
  return Boolean(machine?.teammate && isHeldBy(task, { id: machine.teammate.viewerId }));
}

export function describeHandoffMark(task: Task, machine: TaskMachine) {
  if (machine?.handedBy) return `Handed to you by ${resolveFirstName(machine.handedBy)}`;
  if (machine?.teammate && isHeldByViewer(task, machine))
    return `Handed to you by ${resolveFirstName(machine.teammate.owner)}`;
  const guest = task.handoff?.guest;
  return guest ? `Handed to ${resolveFirstName(guest)}` : 'Hand-off link not opened yet';
}

interface HandoffFact {
  verb: string;
  user: RemoteUser | TaskGuest;
  hint: string;
  icon?: IconName;
}

const OWNER_ICON: IconName = 'IconUser';

export function resolveHandoffFact(task: Task, machine: TaskMachine): HandoffFact | null {
  if (machine?.handedBy)
    return {
      verb: 'Handed to you by',
      user: machine.handedBy,
      hint: 'The task stays theirs and runs on their machine',
    };
  if (machine?.teammate)
    return isHeldByViewer(task, machine)
      ? {
          verb: 'Handed to you by',
          user: machine.teammate.owner,
          hint: 'It runs on their machine. Give it back from the task’s actions.',
        }
      : {
          verb: 'Owned by',
          user: machine.teammate.owner,
          hint: 'A teammate’s task, on their machine',
          icon: OWNER_ICON,
        };
  const guest = task.handoff?.guest;
  if (!guest) return null;
  const hint = task.handoff?.teamId
    ? 'A teammate works on it from Shinsa Cloud'
    : 'They work on it from their own Shinsa';
  return { verb: 'Handed to', user: guest, hint };
}

export const HANDOFF_JOINED = 'Joined';

export const HANDOFF_TURN_OFF = 'Turn off link';

export function describeHandoffBanner(view: HandoffView): Mention | null {
  switch (view.kind) {
    case 'off':
      return null;
    case 'linking':
      return ['Making the hand-off link.'];
    case 'failed':
      return [`The hand-off link couldn’t be made. ${view.message}`];
    case 'ready':
      return ['The first GitHub account to open the hand-off link can work on this task.'];
    case 'claimed':
      return [...describeHandoffClaim(view.guest), '. It stays yours.'];
  }
}

export function handOffTask(task: Task) {
  return sendCommandWithToast({ type: 'task.hand_off', taskId: task.id });
}

export function removeHandoff(task: Task) {
  const guest = task.handoff?.guest;
  const done = guest ? `${resolveFirstName(guest)} no longer has this task.` : 'The hand-off link is off.';
  return sendCommandWithToast({ type: 'handoff.remove', taskId: task.id }, done);
}

export interface HandoffTeammate {
  teamId: string;
  user: RemoteUser;
}

export const HANDOFF_LINK = 'link';

export const HANDOFF_TO_TITLE = 'Hand to';

export function listHandoffTeammates(
  state: ShinsaState,
  task: Task,
  remote: RemoteSnapshot | null
): HandoffTeammate[] {
  const me = remote?.access?.owner.id ?? null;
  const seen = new Set<string>();
  const teammates: HandoffTeammate[] = [];
  for (const entry of remote?.teams ?? []) {
    const team = entry.team;
    if (!(team && entry.status === 'member' && isTeamTask(state, task, team.id))) continue;
    for (const user of [team.owner, ...team.members.map((member) => member.user)]) {
      if (user.id === me || seen.has(user.id)) continue;
      seen.add(user.id);
      teammates.push({ teamId: team.id, user });
    }
  }
  return teammates.sort((left, right) =>
    resolveFirstName(left.user).localeCompare(resolveFirstName(right.user))
  );
}

export function listHandoffTargetItems(teammates: readonly HandoffTeammate[]) {
  return [
    { value: HANDOFF_LINK, label: 'Anyone with the link' },
    ...teammates.map((teammate) => ({ value: teammate.user.id, label: resolveFirstName(teammate.user) })),
  ];
}

export function describeHandToTeammate(user: RemoteUser) {
  return `Hand to ${resolveFirstName(user)}`;
}

export const HANDOFF_TEAMMATE_DESCRIPTION =
  'They see it in their Needs you and work on it from Shinsa Cloud, without a link. It stays yours: it runs here, you see everything they do, and you can take it back at any time.';

export function handToTeammate(task: Task, teammate: HandoffTeammate) {
  const { id, login, name, avatarUrl } = teammate.user;
  return sendCommandWithToast(
    {
      type: 'task.hand_to_teammate',
      taskId: task.id,
      teamId: teammate.teamId,
      teammate: { id, login, name, avatarUrl },
    },
    `Handed to ${resolveFirstName(teammate.user)}.`
  );
}
