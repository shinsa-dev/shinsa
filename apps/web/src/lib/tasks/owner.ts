import {
  isSharedMachine as isSharedSettings,
  type Queue,
  type Settings,
  type Task,
  type TaskOwner,
} from '@shinsa/core';
import type { MachineChoice } from '@/lib/connection/socket.ts';

export interface TaskOwnership {
  shared: boolean;
  sharedHere: boolean;
  viewer: string | null;
  memberHere: boolean;
  isSharedTask: (task: Task) => boolean;
  isMemberTask: (task: Task) => boolean;
}

export const PERSONAL_OWNERSHIP: TaskOwnership = {
  shared: false,
  sharedHere: false,
  viewer: null,
  memberHere: false,
  isSharedTask: () => false,
  isMemberTask: () => false,
};

export const MACHINE_OWNER_KEY = 'machine';

export const MACHINE_OWNER_LABEL = "The machine's owner";

function isSameLogin(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function isOwnTask(task: Task, ownership: TaskOwnership) {
  if (!ownership.isSharedTask(task)) return true;
  if (!task.owner || ownership.viewer === null) return !ownership.isMemberTask(task);
  return isSameLogin(task.owner.login, ownership.viewer);
}

export function isOwnAccount(owner: string | null | undefined, ownership: TaskOwnership) {
  if (!ownership.sharedHere) return true;
  if (!owner || ownership.viewer === null) return !ownership.memberHere;
  return isSameLogin(owner, ownership.viewer);
}

export function describeAccountOwner(owner: string | null | undefined, ownership: TaskOwnership) {
  if (!ownership.sharedHere) return null;
  if (isOwnAccount(owner, ownership)) return 'Yours';
  return owner ? `${owner}’s` : `${MACHINE_OWNER_LABEL}’s`;
}

export function resolveOwnerLogin(task: Task, ownership: TaskOwnership) {
  if (isOwnTask(task, ownership)) return null;
  return task.owner?.login ?? MACHINE_OWNER_KEY;
}

export function filterOwnQueue(queue: Queue, ownership: TaskOwnership): Queue {
  if (!ownership.shared) return queue;
  const own = (task: Task) => isOwnTask(task, ownership);
  return {
    ...queue,
    ready: queue.ready.filter((entry) => own(entry.task)),
    upNow: queue.upNow.filter((entry) => own(entry.task)),
    later: queue.later.filter((entry) => own(entry.task)),
    working: queue.working.filter(own),
    waiting: queue.waiting.filter(own),
    backlog: queue.backlog.filter(own),
    snoozed: queue.snoozed.filter(own),
  };
}

export interface OwnershipSources {
  settings: Pick<Settings, 'sharedTeams'> | null;
  machines: readonly Pick<MachineChoice, 'id' | 'member' | 'state' | 'current'>[];
  viewer: string | null;
  selectTaskMachine: (taskId: string) => string | null;
}

type OwnershipMachine = OwnershipSources['machines'][number];

function isSharedMachine(machine: OwnershipMachine) {
  return isSharedSettings(machine.state.settings);
}

export function resolveTaskOwnership(sources: OwnershipSources): TaskOwnership {
  const { machines } = sources;
  const here = machines.find((machine) => machine.current) ?? machines[0];
  const sharedHere = here
    ? isSharedMachine(here)
    : sources.settings !== null && isSharedSettings(sources.settings);
  if (!sharedHere && !machines.some(isSharedMachine)) return PERSONAL_OWNERSHIP;
  const selectMachine = (task: Task) =>
    machines.length === 1 ? here : machines.find((entry) => entry.id === sources.selectTaskMachine(task.id));
  return {
    shared: true,
    sharedHere,
    viewer: sources.viewer,
    memberHere: here?.member === true,
    isSharedTask: (task) => {
      const machine = selectMachine(task);
      return machine ? isSharedMachine(machine) : machines.length === 0 && sharedHere;
    },
    isMemberTask: (task) => selectMachine(task)?.member === true,
  };
}

export const OWNER_FACT_HINT = "It runs on this person's Claude accounts and GitHub token.";

const YOU_LABEL = 'You';

export interface OwnerFact {
  you: boolean;
  owner: TaskOwner | null;
  label: string;
}

export function resolveOwnerFact(task: Task, ownership: TaskOwnership): OwnerFact | null {
  if (!ownership.isSharedTask(task)) return null;
  const you = isOwnTask(task, ownership);
  return { you, owner: task.owner ?? null, label: you ? YOU_LABEL : MACHINE_OWNER_LABEL };
}
