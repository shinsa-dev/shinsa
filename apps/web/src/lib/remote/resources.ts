import {
  describeGigabytes,
  type MachineResources,
  type ResourceUse,
  resolveMachineLoad,
  type Task,
  type TaskResources,
} from '@shinsa/core';
import type { MachineChoice } from '@/lib/connection/socket.ts';
import { describeMachineLoad } from '@/lib/new-task.ts';

export const NO_RESOURCE_READING = 'No reading yet.';

export const IDLE_TASK_USE = 'No process running.';

export interface TaskResourceRow<T extends Pick<Task, 'title'> = Task> {
  task: T;
  use: string;
  worktree: string | null;
}

export interface MachineResourceRow<T extends Pick<Task, 'title'> = Task> {
  id: string;
  name: string;
  use: string;
  load: string;
  tasks: TaskResourceRow<T>[];
}

function describePercent(value: number) {
  return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

export function describeMachineResources(
  resources: Pick<MachineResources, 'cpuPercent' | 'memoryUsedBytes' | 'memoryTotalBytes' | 'diskFreeBytes'>
) {
  const parts = [
    `CPU ${describePercent(resources.cpuPercent)}`,
    `Memory ${describeGigabytes(resources.memoryUsedBytes)} of ${describeGigabytes(resources.memoryTotalBytes)} GB`,
  ];
  if (resources.diskFreeBytes !== null) parts.push(`${describeGigabytes(resources.diskFreeBytes)} GB free`);
  return parts.join(' · ');
}

function describeUse(label: string, use: ResourceUse) {
  if (use.cpuPercent <= 0 && use.memoryBytes <= 0) return null;
  return `${label} ${describePercent(use.cpuPercent)}, ${describeGigabytes(use.memoryBytes)} GB`;
}

export function describeTaskUse(task: TaskResources) {
  const parts = [
    describeUse('Agent', task.agent),
    describeUse('Services', task.services),
    describeUse('Checks', task.checks),
  ].filter((part) => part !== null);
  return parts.length === 0 ? IDLE_TASK_USE : parts.join(' · ');
}

function resolveTaskWeight(task: TaskResources) {
  return {
    cpu: task.agent.cpuPercent + task.services.cpuPercent + task.checks.cpuPercent,
    memory: task.agent.memoryBytes + task.services.memoryBytes + task.checks.memoryBytes,
  };
}

function compareTaskUse(left: TaskResources, right: TaskResources) {
  const a = resolveTaskWeight(left);
  const b = resolveTaskWeight(right);
  return b.cpu - a.cpu || b.memory - a.memory;
}

export function listTaskResourceRows<T extends Pick<Task, 'title'>>(
  resources: MachineResources,
  tasks: Record<string, T>
): TaskResourceRow<T>[] {
  return [...resources.tasks].sort(compareTaskUse).flatMap((entry) => {
    const task = tasks[entry.taskId];
    if (!task) return [];
    return [
      {
        task,
        use: describeTaskUse(entry),
        worktree:
          entry.worktreeBytes === null ? null : `${describeGigabytes(entry.worktreeBytes)} GB worktree`,
      },
    ];
  });
}

export function listMachineResourceRows<T extends Pick<Task, 'title'>>(
  machines: MachineChoice[],
  tasks: Record<string, T>
): MachineResourceRow<T>[] {
  return machines.map((machine) => ({
    id: machine.id,
    name: machine.name,
    use: machine.resources ? describeMachineResources(machine.resources) : NO_RESOURCE_READING,
    load: describeMachineLoad(resolveMachineLoad(machine)),
    tasks: machine.resources ? listTaskResourceRows(machine.resources, tasks) : [],
  }));
}
