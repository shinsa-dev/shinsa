import { type Gate, listOpenGates, type Run, type Schedule, type ShinsaState, type Task } from '@shinsa/core';
import type { IconName } from '@shinsa/ui/components/icon';
import { formatCount } from '@/lib/format/count.ts';
import type { Tone } from '@/lib/format/tone.ts';
import { resolveProjectInk } from '@/lib/projects.ts';
import {
  AUTOMATION_TYPE_LOOK,
  describeScheduleWhen,
  resolveAutomationType,
  resolveScheduleIcon,
} from '@/lib/schedules.ts';

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
  tone: Tone;
  title: string;
  actor: 'Agent' | 'Shinsa';
  detail: string[];
  filed: Task[];
}

type ReadLook = Pick<AutomationRead, 'icon' | 'tone' | 'title'>;

function describeRead(run: Run, server: string, filed: number): ReadLook {
  if (run.endedAt === null) return { icon: 'IconRadar', tone: 'purple', title: `Reading ${server}` };
  if (run.outcome !== 'completed' || !run.summary) {
    return { icon: 'IconExclamationTriangle', tone: 'amber', title: 'The read did not finish' };
  }
  if (filed === 0) return { icon: 'IconCheckCircle2', tone: 'neutral', title: 'No new reports' };
  return { icon: 'IconListBullets', tone: 'green', title: `Filed ${formatCount(filed, 'task', 'tasks')}` };
}

function describeReadDetail(run: Run, server: string) {
  if (run.summary) return [run.summary];
  if (run.endedAt === null) return [];
  return [`It ended before it said what it read in ${server}. The next read looks again.`];
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
        actor: 'Agent',
        detail: describeReadDetail(run, server),
        filed: made,
      };
    });
}

function describeMissed(schedule: Schedule, outcome: 'skipped' | 'failed'): ReadLook {
  const what = schedule.source ? 'read' : 'run';
  return outcome === 'skipped'
    ? { icon: 'IconClockSnooze', tone: 'neutral', title: `Skipped a ${what}` }
    : { icon: 'IconExclamationCircle', tone: 'red', title: `The ${what} failed` };
}

function describeSent(schedule: Schedule): ReadLook {
  return schedule.target.kind === 'new_task'
    ? { icon: 'IconPlayCircle', tone: 'blue', title: 'Started a task' }
    : { icon: 'IconBubbleText', tone: 'blue', title: 'Messaged its task' };
}

function listScheduleRuns(state: ShinsaState, schedule: Schedule): AutomationRead[] {
  return schedule.runs.flatMap((run): AutomationRead[] => {
    if (run.outcome !== 'sent') {
      return [
        {
          key: `${run.outcome}:${run.at}`,
          at: run.at,
          ...describeMissed(schedule, run.outcome),
          actor: 'Shinsa',
          detail: run.detail ? [run.detail] : [],
          filed: [],
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
        actor: 'Shinsa',
        detail: [],
        filed: task ? [task] : [],
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
  ink?: string;
}

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
    { key: 'type', ...AUTOMATION_TYPE_LOOK[type], label: type, at: null },
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
      ink: resolveProjectInk(project.color),
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
