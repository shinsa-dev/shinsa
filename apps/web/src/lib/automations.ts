import {
  type Gate,
  listOpenGates,
  type Run,
  type Schedule,
  type ShinsaState,
  type Task,
  type UserCommand,
} from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { describeFailure } from '@/lib/connection/commands.ts';
import { sendCommand } from '@/lib/connection/socket.ts';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';
import {
  type AutomationType,
  describeScheduleWhen,
  resolveAutomationType,
  resolveScheduleIcon,
} from '@/lib/schedules.ts';

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
  icon: IconName;
  label: string;
  tone: Tone;
  summary: string | null;
  filed: Task[];
  runId: string | null;
}

type ReadLook = Pick<AutomationRead, 'icon' | 'label' | 'tone'>;

function describeRead(run: Run, server: string, filed: number): ReadLook {
  if (run.endedAt === null) return { icon: 'IconEyeOpen', label: `Reading ${server}`, tone: 'blue' };
  if (run.outcome !== 'completed' || !run.summary) {
    return { icon: 'IconExclamationTriangle', label: 'Did not finish', tone: 'amber' };
  }
  if (filed === 0) return { icon: 'IconEyeOpen', label: `Read ${server}, filed nothing`, tone: 'neutral' };
  return {
    icon: 'IconListBullets',
    label: `Read ${server}, filed ${formatCount(filed, 'task', 'tasks')}`,
    tone: 'green',
  };
}

export function listAutomationTasks(state: ShinsaState, schedule: Schedule) {
  return Object.values(state.tasks)
    .filter((task) =>
      schedule.source
        ? task.sourceReport?.scheduleId === schedule.id
        : task.scheduleId === schedule.id && !task.watchHome
    )
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function describeAutomationTasks(schedule: Schedule) {
  return schedule.source
    ? { title: 'Tasks it filed', empty: 'Nothing filed yet.' }
    : { title: 'Tasks it started', empty: 'No task yet.' };
}

function listIntakeReads(state: ShinsaState, schedule: Schedule, filed: Task[]): AutomationRead[] {
  const homeId = schedule.target.kind === 'task' ? schedule.target.taskId : null;
  const server = schedule.source?.server ?? '';
  return Object.values(state.runs)
    .filter((run) => run.taskId === homeId && run.purpose === 'intake')
    .map((run) => {
      const made = filed.filter((task) => task.createdBy?.runId === run.id);
      return {
        key: run.id,
        at: run.startedAt,
        ...describeRead(run, server, made.length),
        summary: run.summary,
        filed: made,
        runId: run.id,
      };
    });
}

const MISSED_LOOK: Record<'skipped' | 'failed', ReadLook> = {
  skipped: { icon: 'IconClockSnooze', label: 'Skipped', tone: 'neutral' },
  failed: { icon: 'IconExclamationCircle', label: 'Failed', tone: 'red' },
};

function describeSent(schedule: Schedule): ReadLook {
  return schedule.target.kind === 'new_task'
    ? { icon: 'IconPlayCircle', label: 'Started a task', tone: 'blue' }
    : { icon: 'IconBubbleText', label: 'Messaged its task', tone: 'blue' };
}

function listScheduleRuns(state: ShinsaState, schedule: Schedule): AutomationRead[] {
  return schedule.runs.flatMap((run): AutomationRead[] => {
    if (run.outcome !== 'sent') {
      return [
        {
          key: `${run.outcome}:${run.at}`,
          at: run.at,
          ...MISSED_LOOK[run.outcome],
          summary: run.detail,
          filed: [],
          runId: null,
        },
      ];
    }
    if (schedule.source) return [];
    const task = run.taskId ? state.tasks[run.taskId] : undefined;
    return [
      {
        key: `sent:${run.at}`,
        at: run.at,
        ...describeSent(schedule),
        summary: null,
        filed: task ? [task] : [],
        runId: null,
      },
    ];
  });
}

export function listAutomationReads(state: ShinsaState, schedule: Schedule) {
  const tasks = listAutomationTasks(state, schedule);
  return [...listIntakeReads(state, schedule, tasks), ...listScheduleRuns(state, schedule)].sort(
    (a, b) => b.at - a.at
  );
}

export interface AutomationFact {
  key: string;
  icon: IconName;
  label: string;
  tone: Tone;
  hint: string | null;
  at: number | null;
}

const TYPE_ICON: Record<AutomationType, IconName> = {
  Watch: 'IconEyeOpen',
  Schedule: 'IconClock',
  Trigger: 'IconGlobe',
};

const TYPE_HINT: Record<AutomationType, string> = {
  Watch: 'Reads an integration and files a task per new report',
  Schedule: 'Starts or messages a task at a time',
  Trigger: 'Starts a task when its webhook is called',
};

function resolveAutomationState(schedule: Schedule): Omit<AutomationFact, 'key' | 'at'> {
  if (schedule.stopped === 'target_gone') {
    return { icon: 'IconStop', label: 'Stopped', tone: 'neutral', hint: 'What it ran in is gone.' };
  }
  if (schedule.stopped === 'finished') {
    return { icon: 'IconCheckCircle2', label: 'Finished', tone: 'neutral', hint: 'It made all its runs.' };
  }
  if (!schedule.enabled) return { icon: 'IconPause', label: 'Paused', tone: 'neutral', hint: null };
  const last = schedule.runs.at(-1);
  if (last?.outcome === 'failed') {
    return { icon: 'IconExclamationCircle', label: 'Last run failed', tone: 'red', hint: last.detail };
  }
  return { icon: 'IconPlayCircle', label: 'On', tone: 'green', hint: null };
}

function selectAutomationProject(state: ShinsaState, schedule: Schedule) {
  if (schedule.source) return state.projects[schedule.source.projectId] ?? null;
  const target = schedule.target;
  const projectId =
    target.kind === 'task'
      ? state.tasks[target.taskId]?.projectId
      : target.repoId
        ? state.repos[target.repoId]?.projectId
        : null;
  return projectId ? (state.projects[projectId] ?? null) : null;
}

function describeFiledCount(count: number) {
  return count === 0 ? 'Nothing filed yet' : `${formatCount(count, 'task', 'tasks')} filed`;
}

export function listAutomationFacts(state: ShinsaState, schedule: Schedule): AutomationFact[] {
  const type = resolveAutomationType(schedule);
  const source = selectWatchSource(state, schedule);
  const project = selectAutomationProject(state, schedule);
  const last = schedule.runs.filter((run) => run.outcome === 'sent').at(-1);
  const facts: (AutomationFact | null)[] = [
    { key: 'type', icon: TYPE_ICON[type], label: type, tone: 'neutral', hint: TYPE_HINT[type], at: null },
    { key: 'state', ...resolveAutomationState(schedule), at: null },
    source && {
      key: 'source',
      icon: 'IconPlugin1',
      label: source.server,
      tone: 'neutral',
      hint: source.data,
      at: null,
    },
    project && {
      key: 'project',
      icon: 'IconFolder1',
      label: project.name,
      tone: 'neutral',
      hint: 'Project',
      at: null,
    },
    {
      key: 'when',
      icon: resolveScheduleIcon(schedule),
      label: describeScheduleWhen(schedule),
      tone: 'neutral',
      hint: null,
      at: null,
    },
    schedule.enabled && schedule.stopped === null && schedule.nextRunAt !== null
      ? {
          key: 'next',
          icon: 'IconCalendarClock',
          label: 'Next run',
          tone: 'neutral',
          hint: null,
          at: schedule.nextRunAt,
        }
      : null,
    last
      ? {
          key: 'last',
          icon: 'IconHistory',
          label: source ? 'Last read' : 'Last run',
          tone: 'neutral',
          hint: null,
          at: last.at,
        }
      : null,
    source && {
      key: 'filed',
      icon: 'IconListBullets',
      label: describeFiledCount(listAutomationTasks(state, schedule).length),
      tone: 'neutral',
      hint: null,
      at: null,
    },
  ];
  return facts.filter((fact) => fact !== null);
}

export function describeReadsEmpty(schedule: Schedule) {
  if (!schedule.enabled) return 'Nothing yet, and it is paused.';
  return schedule.source
    ? 'No read yet. The first one starts at its next run.'
    : 'Nothing yet. It first runs at its next run.';
}
