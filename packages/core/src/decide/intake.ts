import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  isTaskResting,
  SCHEDULE_LIMITS,
  type Schedule,
  type ScheduleSource,
  type Task,
} from '../domain/index.ts';
import { resolveAgentPrompt } from '../prompts/index.ts';
import { resolveIntakePrompt } from '../prompts/intake.ts';
import { listLiveRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { settleTask } from './lifecycle.ts';
import { findCurrentRun } from './runs.ts';
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
  const listed = known.length > 0 ? ` It lists ${known.join(', ')}.` : ' It lists none yet.';
  throw new DomainError(
    'source_not_found',
    `The project “${project.name}” has no data source \`${source.server}\`. Add it in Settings → Projects first.${listed}`
  );
}

export function assertIntakeTarget(decider: Decider, source: ScheduleSource, taskId: string) {
  const task = decider.state.tasks[taskId];
  if (task?.projectId === source.projectId) return;
  throw new DomainError(
    'source_project',
    'A schedule that reads a data source runs in a task of the same project. Name a task of that project, or leave the target out.'
  );
}

export function isIntakeBusy(decider: Decider, task: Task) {
  return !isTaskResting(task) || listLiveRuns(decider.state, task.id).length > 0;
}

export function startIntake(decider: Decider, schedule: Schedule, task: Task, note: string) {
  const source = schedule.source ? selectProjectSource(decider, schedule.source) : null;
  if (!source) return null;
  decider.stage(task.id, 'watching', `reading ${source.server} for the automation “${schedule.name}”`);
  const prompt = resolveAgentPrompt(resolveIntakePrompt(schedule, source, note));
  const run = decider.startRun(decider.task(task.id), 'agent', prompt, {
    purpose: 'intake',
    resumeFrom: decider.taskSession(task.id, 'agent'),
  });
  return run.id;
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
  decider.endRun(run, 'completed', summary);
  decider.progressed(task.id);
  settleTask(decider, task.id, resolveRestingStage(decider.task(task.id)), 'read a data source');
}
