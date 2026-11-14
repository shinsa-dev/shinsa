import type { ServerHealth } from '../server/schema.ts';
import { LOCAL_SOURCE, SOURCE_LABEL, type SourceSetting } from '../source/schema.ts';
import { describeSource, listSourceOptions } from '../source/source.ts';
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

export function describeTrayStatus(
  health: ServerHealth | null,
  queue: TrayQueue | null = null,
  source: SourceSetting = LOCAL_SOURCE
) {
  if (source.kind === 'cloud') return health ? `Showing ${describeSource(source)}` : TRAY_LABEL.cloudDown;
  if (!health) return 'The engine is not answering';
  if (queue) return 'The engine is running';
  return `The engine is running. ${formatAgents(health.working)}`;
}

export function resolveTrayTitle(queue: TrayQueue | null) {
  const count = queue?.decisions.length ?? 0;
  return count > 0 ? String(count) : '';
}

function listSourceItems(source: SourceSetting): TrayItem[] {
  return [
    { kind: 'separator' },
    { kind: 'header', label: SOURCE_LABEL.menu },
    ...listSourceOptions(source).map((option): TrayItem => ({ kind: 'source', ...option })),
  ];
}

export function listTrayItems(
  health: ServerHealth | null,
  queue: TrayQueue | null = null,
  source: SourceSetting = LOCAL_SOURCE
): TrayItem[] {
  const tasks = health ? queue : null;
  const quitHint = source.kind === 'local' ? TRAY_LABEL.quitHint : TRAY_LABEL.viewerQuitHint;
  return [
    { kind: 'status', label: describeTrayStatus(health, tasks, source) },
    ...(health?.updating ? [{ kind: 'status' as const, label: TRAY_LABEL.updating }] : []),
    ...listSection(TRAY_LABEL.decisions, tasks?.decisions ?? []),
    ...listSection(TRAY_LABEL.working, tasks?.working ?? []),
    ...listSourceItems(source),
    { kind: 'separator' },
    { kind: 'action', action: 'open', label: TRAY_LABEL.open },
    { kind: 'separator' },
    { kind: 'action', action: 'quit', label: TRAY_LABEL.quit, sublabel: quitHint },
  ];
}
