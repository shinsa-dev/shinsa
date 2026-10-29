import {
  type Gate,
  listOpenGates,
  type Run,
  type Schedule,
  type ShinsaState,
  type Task,
  type UserCommand,
} from '@shinsa/core';
import { describeFailure } from '@/lib/connection/commands.ts';
import { sendCommand } from '@/lib/connection/socket.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { describeScheduleWhen, resolveAutomationType } from '@/lib/schedules.ts';

export type AutomationKind = 'schedule' | 'trigger' | 'watch';

export const AUTOMATION_KINDS: readonly { kind: AutomationKind; label: string; hint: string }[] = [
  { kind: 'schedule', label: 'Schedule', hint: 'Starts a task at a time' },
  { kind: 'trigger', label: 'Trigger', hint: 'Starts a task when its webhook is called' },
  { kind: 'watch', label: 'Watch', hint: 'Reads an integration and files a task per new report' },
];

export const AUTOMATION_TEXT_LABEL: Record<AutomationKind, string> = {
  schedule: 'What the task should do',
  trigger: 'What the task should do, with {{body.path}} for parts of the request',
  watch: 'What counts as a report',
};

export const ANY_REPOSITORY = 'any';

export const NO_SOURCES =
  'No project uses an integration yet. Add one to a project in Settings → Projects, then come back.';

const SAVED: Record<AutomationKind, string> = {
  schedule: 'Created the schedule. It starts a task on its first run.',
  trigger: 'Created the trigger. Copy its webhook URL from its menu.',
  watch: 'Created the watch. Its first read starts on its first run.',
};

export function describeAutomationSaved(draft: Pick<AutomationDraft, 'kind'>) {
  return SAVED[draft.kind];
}

export interface AutomationDraft {
  kind: AutomationKind;
  name: string;
  text: string;
  everyMinutes: string;
  repoId: string;
  source: string;
}

export type AutomationField = 'text' | 'everyMinutes' | 'source';

const SOURCE_SEPARATOR = '\u0000';

const MAX_EVERY_MINUTES = 7 * 24 * 60;

export function createAutomationDraft(): AutomationDraft {
  return { kind: 'watch', name: '', text: '', everyMinutes: '60', repoId: ANY_REPOSITORY, source: '' };
}

export function listSourceItems(state: ShinsaState) {
  return Object.values(state.projects).flatMap((project) =>
    (project.watchSources ?? []).map((source) => ({
      value: `${project.id}${SOURCE_SEPARATOR}${source.server}`,
      label: source.server,
      hint: `${project.name} · ${source.data}`,
    }))
  );
}

export function listRepoItems(state: ShinsaState) {
  const repos = Object.values(state.repos)
    .map((repo) => ({ value: repo.id, label: repo.name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: ANY_REPOSITORY, label: 'Shinsa picks the repository' }, ...repos];
}

function readEveryMinutes(draft: AutomationDraft) {
  const minutes = Number(draft.everyMinutes);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_EVERY_MINUTES ? minutes : null;
}

export function validateAutomationDraft(draft: AutomationDraft) {
  const errors: Partial<Record<AutomationField, string>> = {};
  if (!draft.text.trim()) errors.text = 'Say what it should do.';
  if (draft.kind !== 'trigger' && readEveryMinutes(draft) === null) {
    errors.everyMinutes = `Run it every 1 to ${MAX_EVERY_MINUTES} minutes.`;
  }
  if (draft.kind === 'watch' && !draft.source) errors.source = 'Pick the integration it reads.';
  return errors;
}

function resolveSource(draft: AutomationDraft) {
  const [projectId = '', server = ''] = draft.source.split(SOURCE_SEPARATOR);
  return { projectId, server };
}

export function resolveAutomationCommand(draft: AutomationDraft, timeZone: string): UserCommand {
  const watch = draft.kind === 'watch';
  return {
    type: 'schedule.write',
    scheduleId: null,
    name: draft.name.trim() || null,
    text: draft.text.trim(),
    trigger:
      draft.kind === 'trigger'
        ? { kind: 'webhook', signature: null, replayKey: null }
        : { kind: 'interval', everyMinutes: readEveryMinutes(draft) ?? 60 },
    target: watch
      ? null
      : {
          kind: 'new_task',
          repoId: draft.repoId === ANY_REPOSITORY ? null : draft.repoId,
          priority: 'normal',
          mode: 'build',
        },
    source: watch ? resolveSource(draft) : null,
    enabled: null,
    maxRuns: null,
    timeZone,
  };
}

export async function writeAutomation(draft: AutomationDraft) {
  try {
    await sendCommand(resolveAutomationCommand(draft, Intl.DateTimeFormat().resolvedOptions().timeZone));
  } catch (error) {
    return describeFailure(error);
  }
  return null;
}

export function selectWatchOfHome(state: ShinsaState, taskId: string) {
  return (
    Object.values(state.schedules).find(
      (schedule) =>
        schedule.source !== null && schedule.target.kind === 'task' && schedule.target.taskId === taskId
    ) ?? null
  );
}

const WATCH_GATE_TYPES: ReadonlySet<Gate['type']> = new Set<Gate['type']>([
  'question',
  'sign_in',
  'secret',
  'failure',
]);

export function listAutomationGates(state: ShinsaState, schedule: Schedule) {
  const home = schedule.target.kind === 'task' ? state.tasks[schedule.target.taskId] : undefined;
  if (!home?.watchHome) return [];
  return listOpenGates(state, home.id)
    .filter((gate) => WATCH_GATE_TYPES.has(gate.type))
    .map((gate) => ({ home, gate }));
}

export function selectWatchSource(state: ShinsaState, schedule: Schedule) {
  if (!schedule.source) return null;
  const { projectId, server } = schedule.source;
  return state.projects[projectId]?.watchSources?.find((source) => source.server === server) ?? null;
}

export interface AutomationRead {
  key: string;
  at: number;
  label: string;
  tone: Tone;
  summary: string | null;
  filed: Task[];
  runId: string | null;
}

function describeRead(run: Run): Pick<AutomationRead, 'label' | 'tone'> {
  if (run.endedAt === null) return { label: 'Reading now', tone: 'neutral' };
  if (run.outcome === 'completed' && run.summary) return { label: 'Read', tone: 'neutral' };
  return { label: 'Did not finish', tone: 'amber' };
}

export function listAutomationFiled(state: ShinsaState, schedule: Schedule) {
  return Object.values(state.tasks)
    .filter((task) => task.sourceReport?.scheduleId === schedule.id)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function listIntakeReads(state: ShinsaState, schedule: Schedule, filed: Task[]): AutomationRead[] {
  const homeId = schedule.target.kind === 'task' ? schedule.target.taskId : null;
  return Object.values(state.runs)
    .filter((run) => run.taskId === homeId && run.purpose === 'intake')
    .map((run) => ({
      key: run.id,
      at: run.startedAt,
      ...describeRead(run),
      summary: run.summary,
      filed: filed.filter((task) => task.createdBy?.runId === run.id),
      runId: run.id,
    }));
}

function listMissedRuns(schedule: Schedule): AutomationRead[] {
  return schedule.runs
    .filter((run) => run.outcome !== 'sent')
    .map((run) => ({
      key: `${run.outcome}:${run.at}`,
      at: run.at,
      label: run.outcome === 'failed' ? 'Failed' : 'Skipped',
      tone: run.outcome === 'failed' ? ('red' as const) : ('neutral' as const),
      summary: run.detail,
      filed: [],
      runId: null,
    }));
}

export function listAutomationReads(state: ShinsaState, schedule: Schedule) {
  const filed = listAutomationFiled(state, schedule);
  return [...listIntakeReads(state, schedule, filed), ...listMissedRuns(schedule)].sort(
    (a, b) => b.at - a.at
  );
}

export function describeAutomationFacts(state: ShinsaState, schedule: Schedule) {
  const source = selectWatchSource(state, schedule);
  const reads = source ? `Reads ${source.server}: ${source.data}` : null;
  const paused = schedule.enabled ? null : 'Paused';
  return [resolveAutomationType(schedule), reads, describeScheduleWhen(schedule), paused]
    .filter((part) => part !== null)
    .join(' · ');
}

export function describeReadsEmpty(schedule: Schedule) {
  return schedule.enabled
    ? 'No read yet. The first one starts at its next run.'
    : 'No read yet, and it is paused.';
}
