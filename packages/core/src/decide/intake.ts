import {
  DomainError,
  isTaskClosed,
  isTaskResting,
  type Run,
  type Schedule,
  type ScheduleSource,
  type ScheduleTarget,
  type Task,
} from '../domain/index.ts';
import { resolveAgentPrompt } from '../prompts/index.ts';
import { resolveIntakePrompt } from '../prompts/intake.ts';
import type { Decider } from './decider.ts';
import { settleTask } from './lifecycle.ts';
import { listSourceFiledTasks, type ReadReport } from './reads.ts';
import { resolveRestingStage } from './shapes.ts';

export function selectProjectSource(decider: Decider, source: ScheduleSource) {
  const project = decider.state.projects[source.projectId];
  return (project?.watchSources ?? []).find((candidate) => candidate.server === source.server) ?? null;
}

export function findProjectSource(decider: Decider, source: ScheduleSource) {
  const project = decider.state.projects[source.projectId];
  if (!project) throw new DomainError('project_not_found', `No project ${source.projectId}.`);
  const found = selectProjectSource(decider, source);
  if (found) return found;
  const known = (project.watchSources ?? []).map((candidate) => `\`${candidate.server}\``);
  const listed = known.length > 0 ? ` It uses ${known.join(', ')}.` : ' It uses none yet.';
  throw new DomainError(
    'source_not_found',
    `The project “${project.name}” does not use the integration \`${source.server}\`. Add it in Settings → Projects first.${listed}`
  );
}

export function createWatchHome(decider: Decider, source: ScheduleSource, name: string): ScheduleTarget {
  const found = findProjectSource(decider, source);
  const taskId = decider.context.newId();
  decider.emit({
    type: 'task.created',
    taskId,
    request: `Watches ${found.server} for the automation “${name}”: ${found.data}`,
    repoId: null,
    projectId: source.projectId,
    priority: 'normal',
    planFirst: false,
    origin: null,
    mode: 'ask',
    auto: { shape: false, start: false, priority: false },
    watchHome: true,
  });
  decider.stage(taskId, 'done', 'waiting for its first read');
  return { kind: 'task', taskId };
}

export function closeWatchHome(decider: Decider, schedule: Schedule) {
  const home = schedule.target.kind === 'task' ? decider.state.tasks[schedule.target.taskId] : undefined;
  if (!home?.watchHome || isTaskClosed(home)) return;
  if (isTaskResting(home)) {
    decider.stage(home.id, 'cancelled', 'its automation was deleted');
    return;
  }
  settleTask(decider, home.id, 'cancelled', 'its automation was deleted');
}

function resolveLastSentAt(schedule: Schedule) {
  return schedule.runs.filter((run) => run.outcome === 'sent').at(-1)?.at ?? -1;
}

function selectIntakeSchedule(decider: Decider, task: Task) {
  return (
    Object.values(decider.state.schedules).find(
      (candidate) =>
        candidate.source !== null && candidate.target.kind === 'task' && candidate.target.taskId === task.id
    ) ?? null
  );
}

export function findIntakeSchedule(decider: Decider, task: Task) {
  const schedule = selectIntakeSchedule(decider, task);
  if (schedule?.source) return { schedule, source: schedule.source };
  throw new DomainError(
    'schedule_not_found',
    'No automation reads a data source in this task any more. Call `report_read` and stop.'
  );
}

export function missIntakeRead(decider: Decider, runId: string) {
  const run = decider.state.runs[runId];
  if (run?.purpose !== 'intake') return false;
  settleTask(
    decider,
    run.taskId,
    resolveRestingStage(decider.task(run.taskId)),
    'could not read a data source'
  );
  return true;
}

export function startIntake(decider: Decider, schedule: Schedule, task: Task, note: string) {
  const source = schedule.source ? selectProjectSource(decider, schedule.source) : null;
  if (!source) return null;
  if (task.recoveries > 0) decider.emit({ type: 'task.recovered', taskId: task.id, recoveries: 0 });
  decider.stage(task.id, 'watching', `reading ${source.server} for the automation “${schedule.name}”`);
  const filed = listSourceFiledTasks(decider, task.projectId ?? null, source.server);
  const prompt = resolveAgentPrompt(resolveIntakePrompt(schedule, source, note, filed));
  const run = decider.startRun(decider.task(task.id), 'agent', prompt, {
    purpose: 'intake',
    resumeFrom: decider.taskSession(task.id, 'agent'),
  });
  return run.id;
}

export function restartIntakeRead(decider: Decider, task: Task) {
  const schedule = selectIntakeSchedule(decider, task);
  if (schedule && startIntake(decider, schedule, task, schedule.text)) return;
  settleTask(decider, task.id, resolveRestingStage(task), 'no automation reads here any more');
}

export function endIntakeRead(decider: Decider, task: Task, run: Run, read: ReadReport) {
  if (!read.reached) {
    decider.endRun(run, 'failed', read.summary);
    settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'could not reach a data source');
    return;
  }
  const schedule = selectIntakeSchedule(decider, task);
  const readFrom = schedule ? resolveLastSentAt(schedule) : -1;
  if (schedule && readFrom >= 0) decider.emit({ type: 'schedule.read', scheduleId: schedule.id, readFrom });
  decider.endRun(run, 'completed', read.summary);
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'read a data source');
}
