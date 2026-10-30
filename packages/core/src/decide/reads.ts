import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskResting,
  type Run,
  SCHEDULE_LIMITS,
  type SourceReport,
  selectWatchingRun,
  type Task,
} from '../domain/index.ts';
import { resolveFiledRequest } from '../prompts/reads.ts';
import { listLiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { endIntakeRead, findIntakeSchedule, missIntakeRead } from './intake.ts';
import { findCurrentRun } from './runs.ts';
import { createTask } from './tasks.ts';
import { endWatchCheck, missWatchCheck } from './watchdogs.ts';

export interface ReadReport {
  summary: string;
  reached: boolean;
  live: boolean | null;
}

type ReportOrigin = Pick<SourceReport, 'scheduleId' | 'watchdogId' | 'server'>;

export function isReadBusy(decider: Decider, task: Task) {
  return !isTaskResting(task) || listLiveRuns(decider.state, task.id).length > 0;
}

export function listSourceFiledTasks(decider: Decider, projectId: string | null, server: string) {
  return Object.values(decider.state.tasks)
    .filter((task) => task.projectId === projectId && task.sourceReport?.server === server)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, SCHEDULE_LIMITS.filedListed);
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

function resolveSourceReport(command: CommandOf<'agent.file_report'>, origin: ReportOrigin): SourceReport {
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
    ...origin,
    reportId,
    link,
    author: command.author?.trim() || null,
    postedAt: command.postedAt?.trim() || null,
    text,
  };
}

function assertNotFiled(decider: Decider, task: Task, report: SourceReport) {
  const filed = selectFiledTask(decider, task.projectId ?? null, report);
  if (!filed) return;
  throw new DomainError(
    'report_filed',
    `This report was already filed as ${filed.handle ?? filed.id} “${filed.title}”. Skip it and go on.`
  );
}

function assertRepoOfProject(decider: Decider, task: Task, repoId: string | null) {
  if (repoId === null || decider.state.repos[repoId]?.projectId === task.projectId) return;
  throw new DomainError(
    'repo_project',
    'That repository is not in this task’s project. Name one of the project’s repositories, or leave `repository` out.'
  );
}

function resolveRequestKey(report: SourceReport) {
  return report.link ?? report.reportId ?? '';
}

function fileForIntake(decider: Decider, task: Task, run: Run, command: CommandOf<'agent.file_report'>) {
  const { schedule, source } = findIntakeSchedule(decider, task);
  const report = resolveSourceReport(command, {
    scheduleId: schedule.id,
    watchdogId: null,
    server: source.server,
  });
  assertNotFiled(decider, task, report);
  if (command.forkOf === task.id) {
    throw new DomainError(
      'fork_intake',
      '`fork_from` names this task, which reads the source. Name the task that shipped the feature, or leave it out.'
    );
  }
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
      createdBy: { kind: 'intake', taskId: task.id, runId: run.id, requestKey: resolveRequestKey(report) },
      scheduleId: schedule.id,
      sourceReport: report,
    }
  );
}

function fileForWatchdog(decider: Decider, task: Task, run: Run, command: CommandOf<'agent.file_report'>) {
  const watchdog = selectWatchingRun(task, run.id);
  if (!watchdog?.source) {
    throw new DomainError('watchdog_not_found', 'No watchdog waits on this check. End your turn.');
  }
  const report = resolveSourceReport(command, {
    scheduleId: null,
    watchdogId: watchdog.id,
    server: watchdog.source.server,
  });
  assertNotFiled(decider, task, report);
  if (command.forkOf !== null && command.forkOf !== task.id) {
    throw new DomainError(
      'fork_watchdog',
      'A watchdog files forks of the task that shipped the change it watches. Leave `fork_from` out.'
    );
  }
  const repoId = command.repoId ?? task.repoId;
  assertRepoOfProject(decider, task, repoId);
  createTask(
    decider,
    {
      type: 'task.create',
      request: resolveFiledRequest(command, watchdog.source.server),
      repoId,
      priority: task.priority,
      origin: task.origin,
      forkOf: task.id,
    },
    {
      createdBy: { kind: 'watchdog', taskId: task.id, runId: run.id, requestKey: resolveRequestKey(report) },
      sourceReport: report,
    }
  );
}

export function fileReport(decider: Decider, command: CommandOf<'agent.file_report'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'file_report');
  if (run.purpose === 'watch') {
    fileForWatchdog(decider, task, run, command);
    return;
  }
  if (run.purpose === 'intake') {
    fileForIntake(decider, task, run, command);
    return;
  }
  throw new DomainError(
    'wrong_step',
    'You file reports only while you read a data source, for an automation or a watchdog. Use `create_task` for other work.'
  );
}

function resolveReadReport(command: CommandOf<'agent.report_read'>): ReadReport {
  const summary = command.summary.trim();
  if (!summary) throw new DomainError('summary_required', 'Say in `summary` what you read and filed.');
  if (summary.length > SCHEDULE_LIMITS.readSummary) {
    throw new DomainError(
      'summary_too_long',
      `The summary is ${summary.length} characters; the limit is ${SCHEDULE_LIMITS.readSummary}.`
    );
  }
  return { summary, reached: command.reached, live: command.live ?? null };
}

export function reportRead(decider: Decider, command: CommandOf<'agent.report_read'>) {
  const { run, task } = findCurrentRun(decider, command.runId, 'report_read');
  const read = resolveReadReport(command);
  if (run.purpose === 'watch') {
    endWatchCheck(decider, task, run, read);
    return;
  }
  endIntakeRead(decider, task, run, read);
}

export function missRead(decider: Decider, runId: string, reason: string) {
  return missWatchCheck(decider, runId, reason) || missIntakeRead(decider, runId);
}
