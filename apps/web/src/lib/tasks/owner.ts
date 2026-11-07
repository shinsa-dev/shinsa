import type { Queue, Settings, Task, TaskOwner } from '@shinsa/core';
import type { MachineChoice } from '@/lib/connection/socket.ts';

export interface TaskOwnership {
  shared: boolean;
  viewer: string | null;
  memberHere: boolean;
  isMemberTask: (task: Task) => boolean;
}

export const PERSONAL_OWNERSHIP: TaskOwnership = {
  shared: false,
  viewer: null,
  memberHere: false,
  isMemberTask: () => false,
};

export const MACHINE_OWNER_KEY = 'machine';

export const MACHINE_OWNER_LABEL = "The machine's owner";

function isSameLogin(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

export function isOwnTask(task: Task, ownership: TaskOwnership) {
  if (!ownership.shared) return true;
  if (!task.owner || ownership.viewer === null) return !ownership.isMemberTask(task);
  return isSameLogin(task.owner.login, ownership.viewer);
}

export function isOwnAccount(owner: string | null | undefined, ownership: TaskOwnership) {
  if (!ownership.shared) return true;
  if (!owner || ownership.viewer === null) return !ownership.memberHere;
  return isSameLogin(owner, ownership.viewer);
}

export function describeAccountOwner(owner: string | null | undefined, ownership: TaskOwnership) {
  if (!ownership.shared) return null;
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
  settings: Pick<Settings, 'sharedMachine'> | null;
  machines: readonly Pick<MachineChoice, 'id' | 'member' | 'state'>[];
  viewer: string | null;
  selectTaskMachine: (taskId: string) => string | null;
}

export function resolveTaskOwnership(sources: OwnershipSources): TaskOwnership {
  const { machines } = sources;
  const shared =
    sources.settings?.sharedMachine === true ||
    machines.some((machine) => machine.state.settings.sharedMachine === true);
  if (!shared) return PERSONAL_OWNERSHIP;
  return {
    shared,
    viewer: sources.viewer,
    memberHere: machines[0]?.member === true,
    isMemberTask: (task) => {
      const [only] = machines;
      const machine =
        machines.length === 1
          ? only
          : machines.find((entry) => entry.id === sources.selectTaskMachine(task.id));
      return machine?.member === true;
    },
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
  if (!ownership.shared) return null;
  const you = isOwnTask(task, ownership);
  return { you, owner: task.owner ?? null, label: you ? YOU_LABEL : MACHINE_OWNER_LABEL };
}

export const QUEUE_OWNER_CHOICES = [
  { label: 'Your tasks', everyone: false },
  { label: "Everyone's", everyone: true },
] as const;
