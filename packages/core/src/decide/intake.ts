import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskClosed,
  isTaskResting,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleSource,
  type ScheduleTarget,
  type SourceReport,
  type Task,
} from '../domain/index.ts';
import { resolveAgentPrompt } from '../prompts/index.ts';
import { resolveFiledRequest, resolveIntakePrompt } from '../prompts/intake.ts';
import { listLiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { settleTask } from './lifecycle.ts';
import { findCurrentRun } from './runs.ts';
import { resolveRestingStage } from './shapes.ts';
import { createTask } from './tasks.ts';

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

function listFiledTasks(decider: Decider, scheduleId: string) {
  return Object.values(decider.state.tasks)
    .filter((task) => task.sourceReport?.scheduleId === scheduleId)
    .sort((a, b) => b.createdAt - a.createdAt);
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

function findIntakeSchedule(decider: Decider, task: Task) {
  const schedule = selectIntakeSchedule(decider, task);
  if (schedule?.source) return { schedule, source: schedule.source };
  throw new DomainError(
    'schedule_not_found',
    'No automation reads a data source in this task any more. Call `report_intake` and stop.'
  );
}

function isSameReport(known: SourceReport, report: SourceReport) {
  if (known.server !== report.server) return false;
  if (report.reportId !== null && known.reportId === report.reportId) return true;
  return report.link !== null && known.link === report.link;
}

function selectFiledTask(decider: Decider, projectId: string | null, report: SourceReport) {
  return (
    Object.values(decider.state.tasks).find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.sourceReport !== undefined &&
        candidate.sourceReport !== null &&
        isSameReport(candidate.sourceReport, report)
    ) ?? null
  );
}

function resolveSourceReport(command: CommandOf<'agent.file_report'>, scheduleId: string, server: string) {
  const reportId = command.reportId?.trim() || null;
  const link = command.link?.trim() || null;
  if (reportId === null && link === null) {
    throw new DomainError(
      'report_unnamed',
      'Give the report’s `report_id` or `link` in the source, so Shinsa never files it twice.'
    );
  }
  const text = command.text.trim();
  if (!text) throw new DomainError('report_empty', 'Give the report’s own words in `text`.');
  return {
    scheduleId,
    server,
    reportId,
    link,
    author: command.author?.trim() || null,
    postedAt: command.postedAt?.trim() || null,
    text,
  };
}

function assertRepoOfProject(decider: Decider, task: Task, repoId: string | null) {
  if (repoId === null || decider.state.repos[repoId]?.projectId === task.projectId) return;
  throw new DomainError(
    'repo_project',
    'That repository is not in this task’s project. Name one of the project’s repositories, or leave `repository` out.'
  );
}

function assertForkOfOther(task: Task, forkOf: string | null) {
  if (forkOf !== task.id) return;
  throw new DomainError(
    'fork_intake',
    '`fork_from` names this task, which reads the source. Name the task that shipped the feature, or leave it out.'
  );
}

export function fileReport(decider: Decider, command: CommandOf<'agent.file_report'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'file_report');
  if (run.purpose !== 'intake') {
    throw new DomainError(
      'wrong_step',
      'You file reports only while you read a data source for an automation. Use `create_task` for other work.'
    );
  }
  const { schedule, source } = findIntakeSchedule(decider, task);
  const report = resolveSourceReport(command, schedule.id, source.server);
  const filed = selectFiledTask(decider, task.projectId ?? null, report);
  if (filed) {
    throw new DomainError(
      'report_filed',
      `This report was already filed as ${filed.handle ?? filed.id} “${filed.title}”. Skip it and go on.`
    );
  }
  assertForkOfOther(task, command.forkOf);
  assertRepoOfProject(decider, task, command.repoId);
  createTask(
    decider,
    {
      type: 'task.create',
      request: resolveFiledRequest(command, source.server),
      repoId: command.repoId,
      projectId: task.projectId ?? null,
      origin: null,
      ...(command.forkOf ? { forkOf: command.forkOf } : {}),
    },
    {
      createdBy: {
        kind: 'intake',
        taskId: task.id,
        runId: run.id,
        requestKey: report.link ?? report.reportId ?? '',
      },
      scheduleId: schedule.id,
      sourceReport: report,
    }
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

export function isIntakeBusy(decider: Decider, task: Task) {
  return !isTaskResting(task) || listLiveRuns(decider.state, task.id).length > 0;
}

export function startIntake(decider: Decider, schedule: Schedule, task: Task, note: string) {
  const source = schedule.source ? selectProjectSource(decider, schedule.source) : null;
  if (!source) return null;
  if (task.recoveries > 0) decider.emit({ type: 'task.recovered', taskId: task.id, recoveries: 0 });
  decider.stage(task.id, 'watching', `reading ${source.server} for the automation “${schedule.name}”`);
  const filed = listFiledTasks(decider, schedule.id).slice(0, SCHEDULE_LIMITS.filedListed);
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

export function reportIntake(decider: Decider, command: CommandOf<'agent.report_intake'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'report_intake');
  const summary = command.summary.trim();
  if (!summary) throw new DomainError('summary_required', 'Say in `summary` what you read and filed.');
  if (summary.length > SCHEDULE_LIMITS.intakeSummary) {
    throw new DomainError(
      'summary_too_long',
      `The summary is ${summary.length} characters; the limit is ${SCHEDULE_LIMITS.intakeSummary}.`
    );
  }
  if (!command.reached) {
    decider.endRun(run, 'failed', summary);
    settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'could not reach a data source');
    return;
  }
  const schedule = selectIntakeSchedule(decider, task);
  const readFrom = schedule ? resolveLastSentAt(schedule) : -1;
  if (schedule && readFrom >= 0) decider.emit({ type: 'schedule.read', scheduleId: schedule.id, readFrom });
  decider.endRun(run, 'completed', summary);
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'read a data source');
}
