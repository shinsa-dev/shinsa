import type { ServerHealth } from '../server/schema.ts';
import { TRAY_LABEL, TRAY_TASK_LIMIT, type TrayItem, type TrayQueue, type TrayTask } from './schema.ts';

function formatAgents(count: number) {
  if (count === 0) return 'No agents are working';
  return count === 1 ? '1 agent is working' : `${count} agents are working`;
}

function listSection(label: string, tasks: readonly TrayTask[]): TrayItem[] {
  if (tasks.length === 0) return [];
  const shown = tasks.slice(0, TRAY_TASK_LIMIT);
  const more = tasks.length - shown.length;
  return [
    { kind: 'separator' },
    { kind: 'header', label: `${label} (${tasks.length})` },
    ...shown.map((task): TrayItem => ({
      kind: 'task',
      path: task.path,
      label: task.title,
      sublabel: task.detail,
    })),
    ...(more > 0 ? [{ kind: 'task' as const, path: '/', label: `${more} more`, sublabel: 'Open Home' }] : []),
  ];
}

export function describeTrayStatus(health: ServerHealth | null, queue: TrayQueue | null = null) {
  if (!health) return 'The engine is not answering';
  if (queue) return 'The engine is running';
  return `The engine is running. ${formatAgents(health.working)}`;
}

export function resolveTrayTitle(queue: TrayQueue | null) {
  const count = queue?.decisions.length ?? 0;
  return count > 0 ? String(count) : '';
}

export function listTrayItems(health: ServerHealth | null, queue: TrayQueue | null = null): TrayItem[] {
  const tasks = health ? queue : null;
  return [
    { kind: 'status', label: describeTrayStatus(health, tasks) },
    ...(health?.updating ? [{ kind: 'status' as const, label: TRAY_LABEL.updating }] : []),
    ...listSection(TRAY_LABEL.decisions, tasks?.decisions ?? []),
    ...listSection(TRAY_LABEL.working, tasks?.working ?? []),
    { kind: 'separator' },
    { kind: 'action', action: 'open', label: TRAY_LABEL.open },
    { kind: 'separator' },
    { kind: 'action', action: 'quit', label: TRAY_LABEL.quit, sublabel: TRAY_LABEL.quitHint },
  ];
}
