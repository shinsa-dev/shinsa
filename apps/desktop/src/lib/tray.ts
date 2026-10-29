import type { ServerHealth } from './health.ts';

export interface TrayTask {
  path: string;
  title: string;
  detail: string;
}

export interface TrayQueue {
  decisions: TrayTask[];
  working: TrayTask[];
}

export type TrayItem =
  | { kind: 'status'; label: string }
  | { kind: 'header'; label: string }
  | { kind: 'separator' }
  | { kind: 'task'; path: string; label: string; sublabel: string }
  | { kind: 'action'; action: TrayAction; label: string; sublabel?: string };

export type TrayAction = 'open' | 'quit';

export const TRAY_LABEL = {
  open: 'Open Shinsa',
  quit: 'Quit Shinsa',
  quitHint: 'The engine and your agents keep running',
  decisions: 'Needs you',
  working: 'Working',
  updating: 'Moves to the new version once agents hand over',
} as const;

export const TRAY_TASK_LIMIT = 5;

const TITLE_MAX = 48;

function truncate(text: string) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function parseTask(value: unknown): TrayTask | null {
  if (typeof value !== 'object' || value === null) return null;
  const { taskId, handle, title, label } = value as Record<string, unknown>;
  if (typeof taskId !== 'string' || !taskId || typeof title !== 'string' || typeof label !== 'string')
    return null;
  const reference = typeof handle === 'string' && handle ? handle : taskId;
  const detail = capitalize(label);
  return {
    path: `/tasks/${encodeURIComponent(reference)}`,
    title: truncate(title),
    detail: typeof handle === 'string' && handle ? `${detail} · ${handle}` : detail,
  };
}

function parseTasks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => parseTask(entry) ?? []);
}

export function parseTrayQueue(value: unknown): TrayQueue | null {
  if (typeof value !== 'object' || value === null) return null;
  const { decisions, working } = value as Record<string, unknown>;
  if (!Array.isArray(decisions) || !Array.isArray(working)) return null;
  return { decisions: parseTasks(decisions), working: parseTasks(working) };
}

export function parseTrayQueueText(text: string) {
  try {
    return parseTrayQueue(JSON.parse(text));
  } catch {
    return null;
  }
}

function formatAgents(count: number) {
  if (count === 0) return 'No agents are working';
  return count === 1 ? '1 agent is working' : `${count} agents are working`;
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

function listSection(label: string, tasks: TrayTask[]): TrayItem[] {
  if (tasks.length === 0) return [];
  const shown = tasks.slice(0, TRAY_TASK_LIMIT);
  const more = tasks.length - shown.length;
  return [
    { kind: 'separator' },
    { kind: 'header', label: `${label} (${tasks.length})` },
    ...shown.map(
      (task): TrayItem => ({ kind: 'task', path: task.path, label: task.title, sublabel: task.detail })
    ),
    ...(more > 0 ? [{ kind: 'task' as const, path: '/', label: `${more} more`, sublabel: 'Open Home' }] : []),
  ];
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
