import {
  type CheckSource,
  type CiRun,
  type Evidence,
  isBlockingCheck,
  listTaskChecks,
  type PullRequestCheckStatus,
  type ReportCheck,
  type ShinsaState,
  type Task,
  type TaskCheck,
} from '@shinsa/core';
import type { EvidenceCheck } from '@/lib/evidence/layout.ts';
import { formatCount } from '@/lib/format/count.ts';

export type CheckState =
  | 'passed'
  | 'failed'
  | 'running'
  | 'not_run'
  | 'skipped'
  | 'passed_alone'
  | 'fails_on_base'
  | 'cancelled'
  | 'action_required'
  | 'neutral';

type CheckOrigin = CheckSource | 'ci';

export interface CheckRow {
  key: string;
  id: string | null;
  label: string;
  command: string | null;
  state: CheckState;
  origin: CheckOrigin;
  meta: string;
  note: string | null;
  detail: string | null;
  url: string | null;
  output: Evidence | null;
}

type CheckStageKey = 'building' | 'ci';

export type CheckStageStatus = 'running' | 'failed' | 'passed' | 'partial' | 'idle';

export interface CheckStage {
  key: CheckStageKey;
  title: string;
  summary: string;
  status: CheckStageStatus;
  rows: CheckRow[];
}

export interface ChecksView {
  stages: CheckStage[];
  summary: string;
  status: CheckStageStatus;
}

export const CHECK_STATE_LABEL: Record<CheckState, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  not_run: 'Not run yet',
  skipped: 'Skipped',
  passed_alone: 'Passed',
  fails_on_base: 'Not blocking',
  cancelled: 'Cancelled',
  action_required: 'Needs action',
  neutral: 'Neutral',
};

const STAGE_TITLE: Record<CheckStageKey, string> = { building: 'Building', ci: 'CI' };

const ORIGIN_LABEL: Record<CheckSource, string> = {
  plan: 'From the plan',
  agent: 'Added by the agent',
  repo: 'Repository',
};

const CI_STATE: Record<PullRequestCheckStatus, CheckState> = {
  pending: 'running',
  success: 'passed',
  failure: 'failed',
  cancelled: 'cancelled',
  action_required: 'action_required',
  skipped: 'skipped',
  neutral: 'neutral',
};

const DONE_STATES: ReadonlySet<CheckState> = new Set<CheckState>([
  'passed',
  'passed_alone',
  'fails_on_base',
  'skipped',
  'neutral',
]);

const FAILED_STATES: ReadonlySet<CheckState> = new Set<CheckState>([
  'failed',
  'cancelled',
  'action_required',
]);

function countPlanPhases(task: Task) {
  return task.plan?.document?.phases.length ?? 0;
}

function joinNumbers(numbers: readonly number[]) {
  if (numbers.length < 2) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`;
}

export function describeCheckPhases(phases: readonly number[]) {
  const sorted = [...new Set(phases)].sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (first === undefined || last === undefined) return null;
  if (sorted.length === 1) return `phase ${first}`;
  const contiguous = last - first === sorted.length - 1;
  return contiguous ? `phases ${first} to ${last}` : `phases ${joinNumbers(sorted)}`;
}

function describeCheckMeta(check: TaskCheck, planPhases: number) {
  if (check.source === 'repo') return `${ORIGIN_LABEL.repo} · before review`;
  const phases = planPhases > 1 ? describeCheckPhases(check.phases) : null;
  return phases ? `${ORIGIN_LABEL[check.source]} · ${phases}` : ORIGIN_LABEL[check.source];
}

export function resolveBaseBranch(state: Pick<ShinsaState, 'repos'>, task: Task) {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  return task.stackedOn?.branch ?? task.pullRequest?.base ?? repo?.defaultBranch ?? null;
}

function describeCheckNote(result: ReportCheck, base: string | null) {
  if (result.note === 'passed_alone') return 'Passed when re-run alone';
  if (result.note === 'fails_on_base') {
    return `Already failing on ${base ?? 'the base branch'}, so it does not block`;
  }
  return null;
}

function resolveResultState(result: ReportCheck): CheckState {
  if (result.note === 'fails_on_base') return 'fails_on_base';
  if (result.outcome === 'skipped') return 'skipped';
  if (result.outcome === 'fail') return 'failed';
  return result.note === 'passed_alone' ? 'passed_alone' : 'passed';
}

export function listRunningCheckIds(task: Task) {
  return new Set(task.stage === 'checking' ? (task.runningChecks ?? []) : []);
}

export function selectCheckOutput(evidence: ShinsaState['evidence'], taskId: string, checkId: string) {
  let latest: Evidence | null = null;
  for (const piece of Object.values(evidence)) {
    if (piece.taskId !== taskId || piece.checkId !== checkId || piece.runId !== null) continue;
    if (!latest || piece.attachedAt >= latest.attachedAt) latest = piece;
  }
  return latest;
}

function resolveTaskCheckRow(
  state: Pick<ShinsaState, 'repos' | 'evidence'>,
  task: Task,
  check: TaskCheck,
  result: ReportCheck | undefined,
  running: boolean
): CheckRow {
  const resultState = result ? resolveResultState(result) : 'not_run';
  return {
    key: check.id,
    id: check.id,
    label: check.label,
    command: check.command === check.label ? null : check.command,
    state: running ? 'running' : resultState,
    origin: check.source,
    meta: describeCheckMeta(check, countPlanPhases(task)),
    note: result && !running ? describeCheckNote(result, resolveBaseBranch(state, task)) : null,
    detail: result?.outcome === 'fail' && !running ? result.detail : null,
    url: null,
    output: selectCheckOutput(state.evidence, task.id, check.id),
  };
}

function describeCiMeta(run: CiRun) {
  if (run.required === true) return 'Required';
  return run.required === false ? 'Optional' : 'CI';
}

function resolveCiRow(run: CiRun): CheckRow {
  return {
    key: `ci:${run.name}`,
    id: null,
    label: run.name,
    command: null,
    state: CI_STATE[run.status],
    origin: 'ci',
    meta: describeCiMeta(run),
    note: null,
    detail: null,
    url: run.url,
    output: null,
  };
}

function resolveStageStatus(rows: readonly CheckRow[]): CheckStageStatus {
  if (rows.some((row) => row.state === 'running')) return 'running';
  if (rows.some((row) => FAILED_STATES.has(row.state))) return 'failed';
  const done = rows.filter((row) => DONE_STATES.has(row.state)).length;
  if (done === 0) return 'idle';
  return done === rows.length ? 'passed' : 'partial';
}

function describeStageSummary(rows: readonly CheckRow[], status: CheckStageStatus) {
  const total = rows.length;
  const count = (states: ReadonlySet<CheckState>) => rows.filter((row) => states.has(row.state)).length;
  switch (status) {
    case 'running':
      return `Running ${formatCount(rows.filter((row) => row.state === 'running').length, 'check', 'checks')}`;
    case 'failed':
      return total === 1 ? 'Failed' : `${count(FAILED_STATES)} of ${total} failed`;
    case 'passed':
      return total === 1 ? 'Passed' : `All ${total} passed`;
    case 'partial':
      return `${count(DONE_STATES)} passed, ${total - count(DONE_STATES)} not run yet`;
    case 'idle':
      return 'Not run yet';
  }
}

function createStage(key: CheckStageKey, rows: CheckRow[], fallback: CheckStageStatus = 'idle'): CheckStage {
  const status = rows.length === 0 ? fallback : resolveStageStatus(rows);
  return { key, title: STAGE_TITLE[key], summary: describeStageSummary(rows, status), status, rows };
}

const CI_FALLBACK: Record<NonNullable<Task['pullRequest']>['checks'], CheckStageStatus> = {
  passing: 'passed',
  failing: 'failed',
  pending: 'running',
  none: 'idle',
};

function resolveCiStage(task: Task): CheckStage | null {
  const pullRequest = task.pullRequest;
  if (!pullRequest) return null;
  const runs = pullRequest.checkRuns ?? [];
  if (runs.length === 0 && pullRequest.checks === 'none') return null;
  const stage = createStage('ci', runs.map(resolveCiRow), CI_FALLBACK[pullRequest.checks]);
  if (runs.length > 0) return stage;
  return { ...stage, summary: CI_SUMMARY[stage.status] };
}

const CI_SUMMARY: Record<CheckStageStatus, string> = {
  running: 'Running',
  failed: 'Failing',
  passed: 'Passing',
  partial: 'Passing',
  idle: 'Not run yet',
};

function resolveBuildingStage(state: Pick<ShinsaState, 'repos' | 'evidence'>, task: Task) {
  const own = task.checks ?? [];
  if (own.length === 0 && (task.checkResults ?? []).length === 0) return null;
  const repo = task.repoId ? (state.repos[task.repoId] ?? null) : null;
  const checks = listTaskChecks(task, repo);
  const results = new Map((task.checkResults ?? []).map((result) => [result.id, result]));
  const running = listRunningCheckIds(task);
  const rows = checks.map((check) =>
    resolveTaskCheckRow(state, task, check, results.get(check.id), running.has(check.id))
  );
  return rows.length > 0 ? createStage('building', rows) : null;
}

function resolveViewStatus(stages: readonly CheckStage[]): CheckStageStatus {
  const statuses = new Set(stages.map((stage) => stage.status));
  for (const status of ['running', 'failed', 'partial', 'passed'] as const) {
    if (statuses.has(status)) return status;
  }
  return 'idle';
}

function describeViewSummary(stages: readonly CheckStage[], status: CheckStageStatus) {
  const leads = stages.filter((stage) => stage.status === status);
  const lead = leads.find((stage) => stage.key === 'building') ?? leads[0];
  if (!lead || lead.key === 'ci') return `CI ${CI_SUMMARY[status].toLowerCase()}`;
  return describeBuildingSummary(lead);
}

function describeRowResults(rows: readonly CheckRow[]) {
  return describePassCount(rows.filter((row) => DONE_STATES.has(row.state)).length, rows.length);
}

function describeBuildingSummary(stage: CheckStage) {
  const total = stage.rows.length;
  switch (stage.status) {
    case 'running':
      return stage.summary;
    case 'partial': {
      const done = stage.rows.filter((row) => DONE_STATES.has(row.state)).length;
      return `${formatCount(done, 'check', 'checks')} passed, ${total - done} not run yet`;
    }
    case 'failed':
    case 'passed':
      return describeRowResults(stage.rows.filter((row) => row.state !== 'not_run'));
    case 'idle':
      return `${formatCount(total, 'check', 'checks')}, not run yet`;
  }
}

function describePassCount(passed: number, total: number) {
  if (total === 1) return passed === 1 ? 'The check passed' : 'The check failed';
  if (passed === total) return `All ${total} checks passed`;
  return `${passed} of ${formatCount(total, 'check', 'checks')} passed`;
}

export function resolveChecksView(
  state: Pick<ShinsaState, 'repos' | 'evidence'>,
  task: Task
): ChecksView | null {
  const stages = [resolveBuildingStage(state, task), resolveCiStage(task)].filter(
    (stage): stage is CheckStage => stage !== null
  );
  if (stages.length === 0) return null;
  const status = resolveViewStatus(stages);
  return { stages, summary: describeViewSummary(stages, status), status };
}

export function describeChecksPassed(results: readonly ReportCheck[]) {
  return describePassCount(results.filter((result) => !isBlockingCheck(result)).length, results.length);
}

export function resolveEvidenceCheckRow(
  view: ChecksView | null,
  check: Pick<EvidenceCheck, 'id' | 'output'>,
  title: string
): CheckRow {
  const row = view?.stages.flatMap((stage) => stage.rows).find((candidate) => candidate.id === check.id);
  const output = check.output?.evidence ?? row?.output ?? null;
  if (row) return { ...row, output };
  return {
    key: check.id,
    id: check.id,
    label: title,
    command: null,
    state: 'not_run',
    origin: 'agent',
    meta: 'No longer one of the task’s checks',
    note: null,
    detail: null,
    url: null,
    output,
  };
}

const STATUS_STATE: Record<CheckStageStatus, CheckState> = {
  running: 'running',
  failed: 'failed',
  passed: 'passed',
  partial: 'passed',
  idle: 'not_run',
};

export function resolveStatusState(status: CheckStageStatus) {
  return STATUS_STATE[status];
}
