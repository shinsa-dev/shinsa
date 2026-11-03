import { TERMINAL_LIMITS, type TerminalInfo } from '@shinsa/core';
import type { TaskDescriber, TerminalHolder } from './schema.ts';

const LIST = new Intl.ListFormat('en', { type: 'conjunction' });

function resolveReclaimRank(info: TerminalInfo, describeTask: TaskDescriber) {
  if (info.taskId !== null && (describeTask(info.taskId)?.settled ?? true)) return 0;
  if (info.serviceId !== null) return 1;
  if (info.taskId !== null) return 2;
  return 3;
}

export function listReclaimable(ended: TerminalInfo[], describeTask: TaskDescriber) {
  return ended
    .map((info) => ({ info, rank: resolveReclaimRank(info, describeTask) }))
    .sort((a, b) => a.rank - b.rank || (a.info.endedAt ?? 0) - (b.info.endedAt ?? 0))
    .map((entry) => entry.info.id);
}

function describeHolder(handle: string, holders: TerminalHolder[]) {
  const services = holders.flatMap((holder) => (holder.service === null ? [] : [holder.service]));
  const shells = holders.length - services.length;
  const parts = [...services, ...(shells === 0 ? [] : [shells === 1 ? 'a shell' : `${shells} shells`])];
  return `${handle} runs ${LIST.format(parts)}.`;
}

export function resolveLimitMessage(holders: TerminalHolder[], describeTask: TaskDescriber) {
  const byTask = new Map<string, TerminalHolder[]>();
  for (const holder of holders)
    if (holder.taskId !== null) byTask.set(holder.taskId, [...(byTask.get(holder.taskId) ?? []), holder]);
  const yours = holders.filter((holder) => holder.taskId === null).length;
  return [
    `Shinsa keeps ${TERMINAL_LIMITS.terminals} terminals at most, and all of them run.`,
    ...[...byTask].map(([taskId, held]) =>
      describeHolder(describeTask(taskId)?.handle ?? 'Another task', held)
    ),
    ...(yours === 0 ? [] : [yours === 1 ? '1 is yours.' : `${yours} are yours.`]),
    'Stop a service or close a terminal to free one.',
  ].join(' ');
}
