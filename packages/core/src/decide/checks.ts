import type { CommandOf } from '../commands/index.ts';
import {
  type CheckEvidence,
  DomainError,
  isBlockingCheck,
  listBlockingChecks,
  listPhaseChecks,
  listRepoChecks,
  listTaskChecks,
  listTouchedPhaseChecks,
  resolveNextCheckId,
  resolveRoundStamp,
  type Task,
} from '../domain/index.ts';
import { resolveChecksFixPrompt } from '../prompts/index.ts';
import type { CheckChange, CheckChangeHandOver, ReportCheck, TaskCheck } from '../report/types.ts';
import type { Decider } from './decider.ts';
import { applyEditsApproval } from './edits.ts';
import { startFix } from './fixes.ts';
import { resolveCurrentPhase, startPhase, startReview } from './lifecycle.ts';
import { shipReviewedWork } from './pull-requests.ts';

const CHECKING_EDITS = 'committing your edits and running the checks';

function countPlanPhases(task: Task) {
  return task.plan?.document?.phases.length ?? 0;
}

function countDonePhases(task: Task) {
  return new Set(task.phaseReports.map((report) => report.index)).size;
}

function hasPhasesLeft(task: Task) {
  return countDonePhases(task) < countPlanPhases(task);
}

function describeIds(checks: readonly TaskCheck[]) {
  return checks.map((check) => `${check.id} (${check.label})`).join(', ');
}

export function findTaskCheck(decider: Decider, task: Task, id: string) {
  const checks = listTaskChecks(task, decider.repoOf(task));
  const check = checks.find((candidate) => candidate.id === id);
  if (check) return check;
  const known = checks.length > 0 ? `The checks are ${describeIds(checks)}.` : 'The task has no checks yet.';
  throw new DomainError('check_unknown', `There is no check ${id}. ${known}`);
}

function findAgentCheck(decider: Decider, task: Task, id: string) {
  const check = findTaskCheck(decider, task, id);
  if (check.source !== 'repo') return check;
  throw new DomainError(
    'check_human_only',
    `${id} is the repository’s own command, \`${check.command}\`. Only the human changes it, in Settings → Projects.`
  );
}

function assertPhases(task: Task, phases: number[] | null) {
  const total = countPlanPhases(task);
  const outside = (phases ?? []).filter((phase) => phase > total);
  if (outside.length === 0) return;
  throw new DomainError(
    'check_phases_invalid',
    `The plan has ${total} phases, so a check cannot cover phase ${outside.join(', ')}.`
  );
}

function listDefaultPhases(task: Task, from: number) {
  const total = Math.max(1, countPlanPhases(task));
  const first = Math.min(Math.max(1, from), total);
  return Array.from({ length: total - first + 1 }, (_, index) => first + index);
}

function addCheck(task: Task, change: CheckChangeHandOver, from: number): CheckChange {
  const command = change.command ?? '';
  const duplicate = (task.checks ?? []).find((existing) => existing.command === command);
  if (duplicate) {
    throw new DomainError(
      'check_exists',
      `\`${command}\` is already ${duplicate.id}, “${duplicate.label}”. Change that check instead.`
    );
  }
  const check: TaskCheck = {
    id: resolveNextCheckId(task),
    label: change.label ?? command,
    command,
    phases: change.phases ?? listDefaultPhases(task, from),
    source: 'agent',
  };
  return { action: 'add', check, reason: change.reason };
}

function resolveCheckChange(
  decider: Decider,
  task: Task,
  change: CheckChangeHandOver,
  from: number
): CheckChange {
  assertPhases(task, change.phases);
  if (change.action === 'add') return addCheck(task, change, from);
  const current = findAgentCheck(decider, task, change.id ?? '');
  if (change.action === 'remove') return { action: 'remove', check: current, reason: change.reason };
  const check: TaskCheck = {
    ...current,
    ...(change.label === null ? {} : { label: change.label }),
    ...(change.command === null ? {} : { command: change.command }),
    ...(change.phases === null ? {} : { phases: change.phases }),
  };
  return { action: 'change', check, reason: change.reason };
}

function applyCheckChange(checks: TaskCheck[], change: CheckChange) {
  if (change.action === 'add') return [...checks, change.check];
  if (change.action === 'remove') return checks.filter((check) => check.id !== change.check.id);
  return checks.map((check) => (check.id === change.check.id ? change.check : check));
}

export function resolveCheckChanges(
  decider: Decider,
  task: Task,
  changes: readonly CheckChangeHandOver[],
  from: number
) {
  let working = task;
  const resolved: CheckChange[] = [];
  for (const change of changes) {
    const item = resolveCheckChange(decider, working, change, from);
    resolved.push(item);
    working = { ...working, checks: applyCheckChange(working.checks ?? [], item) };
  }
  return resolved;
}

export function recordCheckChanges(decider: Decider, taskId: string, runId: string, changes: CheckChange[]) {
  if (changes.length === 0) return [];
  decider.emit({ type: 'checks.changed', taskId, changes, runId });
  const kept = new Set((decider.task(taskId).checks ?? []).map((check) => check.id));
  return changes.filter((change) => kept.has(change.check.id)).map((change) => change.check.id);
}

export function assertCheckIds(decider: Decider, task: Task, ids: readonly string[]) {
  for (const id of ids) findTaskCheck(decider, task, id);
}

function selectChecks(decider: Decider, task: Task, ids: ReadonlySet<string>) {
  return listTaskChecks(task, decider.repoOf(task)).filter((check) => ids.has(check.id));
}

function listBaselineIds(decider: Decider, task: Task) {
  return listRepoChecks(decider.repoOf(task)).map((check) => check.id);
}

function runChecks(decider: Decider, taskId: string, ids: readonly string[], reason: string) {
  decider.cancelRuns(taskId);
  decider.cancelEffects(taskId, ['checks.run'], 'A new round of checks replaced it.');
  const task = decider.task(taskId);
  const checks = selectChecks(decider, task, new Set(ids));
  if (checks.length === 0) {
    proceedAfterChecks(decider, taskId);
    return;
  }
  decider.stage(taskId, 'checking', reason);
  decider.emit({ type: 'checks.started', taskId, checkIds: checks.map((check) => check.id) });
  decider.run({
    kind: 'checks.run',
    taskId,
    round: task.fixRounds,
    checks: checks.map(({ id, label, command }) => ({ id, label, command })),
    coverage: !hasPhasesLeft(task),
  });
}

function describePhaseRun(task: Task, phase: number) {
  if (!hasPhasesLeft(task)) return 'running the checks before review';
  return `running the checks for phase ${phase} of ${countPlanPhases(task)}`;
}

export function startPhaseChecks(
  decider: Decider,
  taskId: string,
  phase: number,
  changed: readonly string[]
) {
  const task = decider.task(taskId);
  const baseline = hasPhasesLeft(task) ? [] : listBaselineIds(decider, task);
  const ids = [...listPhaseChecks(task, phase).map((check) => check.id), ...changed, ...baseline];
  runChecks(decider, taskId, ids, describePhaseRun(task, phase));
}

export function startFixChecks(
  decider: Decider,
  taskId: string,
  named: readonly string[],
  files: readonly string[]
) {
  const task = decider.task(taskId);
  const failing = listBlockingChecks(task).map((check) => check.id);
  const touched = listTouchedPhaseChecks(task, files).map((check) => check.id);
  runChecks(decider, taskId, [...failing, ...named, ...touched], 'running the checks again after the fix');
}

export function startEditsChecks(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const ids = listTaskChecks(task, decider.repoOf(task)).map((check) => check.id);
  runChecks(decider, taskId, ids, CHECKING_EDITS);
}

export function retryChecks(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  const failing = listBlockingChecks(task).map((check) => check.id);
  runChecks(decider, taskId, [...(task.runningChecks ?? []), ...failing], task.stageReason);
}

function proceedAfterChecks(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (hasPhasesLeft(task)) {
    startPhase(decider, taskId, resolveCurrentPhase(task));
    return;
  }
  if (applyEditsApproval(decider, taskId, 'review')) shipReviewedWork(decider, taskId);
  else startReview(decider, taskId);
}

function reactToChecks(decider: Decider, taskId: string, results: ReportCheck[]) {
  const blocking = results.filter(isBlockingCheck);
  if (blocking.length === 0) {
    decider.progressed(taskId);
    proceedAfterChecks(decider, taskId);
    return;
  }
  const signature = [...new Set(blocking.map((check) => check.id))].sort().join('\n');
  const prompt = resolveChecksFixPrompt(results, hasPhasesLeft(decider.task(taskId)));
  startFix(decider, taskId, 'checks', prompt, signature);
}

function attachCheckOutput(decider: Decider, task: Task, output: CheckEvidence) {
  decider.emit({
    type: 'evidence.attached',
    evidence: {
      id: decider.context.newId(),
      taskId: task.id,
      runId: null,
      kind: 'check',
      title: output.title,
      uri: output.uri,
      attachedAt: decider.context.now,
      checkId: output.checkId,
      ...resolveRoundStamp(task),
    },
  });
}

export function recordChecks(decider: Decider, command: CommandOf<'checks.record'>) {
  const task = decider.task(command.taskId);
  if (task.stage !== 'checking' || command.results.length === 0) return;
  decider.emit({
    type: 'checks.recorded',
    taskId: command.taskId,
    results: command.results,
    ...(command.coverage ? { coverage: command.coverage } : {}),
  });
  for (const output of command.outputs ?? []) attachCheckOutput(decider, task, output);
  reactToChecks(decider, command.taskId, command.results);
}
