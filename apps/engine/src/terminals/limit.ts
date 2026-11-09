import { isTaskSettled, SERVICE_LIMITS, type Task, TERMINAL_LIMITS, type TerminalInfo } from '@shinsa/core';
import type { TerminalHolder } from './schema.ts';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

export function listReclaimable(ended: TerminalInfo[], tasks: Readonly<Record<string, Task>>) {
  const rankOf = (info: TerminalInfo) => {
    const task = info.taskId === null ? undefined : tasks[info.taskId];
    if (info.taskId !== null && (!task || isTaskSettled(task))) return 0;
    if (info.serviceId !== null) return 1;
    if (info.taskId !== null) return 2;
    return 3;
  };
  return ended
    .map((info) => ({ info, rank: rankOf(info) }))
    .sort((a, b) => a.rank - b.rank || (a.info.endedAt ?? 0) - (b.info.endedAt ?? 0))
    .map((entry) => entry.info.id);
}

export function resolveLimitMessage(holders: TerminalHolder[], tasks: Readonly<Record<string, Task>>) {
  const byTask = new Map<string, TerminalHolder[]>();
  for (const holder of holders)
    if (holder.taskId !== null) byTask.set(holder.taskId, [...(byTask.get(holder.taskId) ?? []), holder]);
  const yours = holders.filter((holder) => holder.taskId === null).length;
  const describeHolder = (taskId: string, held: TerminalHolder[]) => {
    const services = held.flatMap((holder) => (holder.service === null ? [] : [holder.service]));
    const shells = held.length - services.length;
    const parts = [...services, ...(shells === 0 ? [] : [shells === 1 ? 'a shell' : `${shells} shells`])];
    return `${tasks[taskId]?.handle ?? 'Another task'} runs ${LIST.format(parts)}.`;
  };
  return [
    `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most, and all of them run.`,
    ...[...byTask].map(([taskId, held]) => describeHolder(taskId, held)),
    ...(yours === 0 ? [] : [yours === 1 ? '1 is yours.' : `${yours} are yours.`]),
    'Stop a service or close a terminal to free one.',
  ].join(' ');
}

export function resolveServiceLimitMessage(names: readonly string[], adding: number) {
  const over = names.length + adding - SERVICE_LIMITS.services;
  return [
    `This project keeps ${SERVICE_LIMITS.services} services at most, and has ${names.length}: ${LIST.format(names)}.`,
    `Remove ${over === 1 ? 'one' : over} under Services to add ${adding === 1 ? 'another' : `these ${adding}`}.`,
  ].join(' ');
}
