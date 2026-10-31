import { splitMessageAttachments } from '../chat/attachments.ts';
import { isCurrentEvidence } from '../domain/evidence.ts';
import type { Round } from '../domain/rounds.ts';
import type {
  Activity,
  ActivityKind,
  Evidence,
  PhaseReport,
  Plan,
  PullRequest,
  Task,
} from '../domain/types.ts';
import { serializePlanMarkdown } from '../report/markdown.ts';
import type { ReviewFinding } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';

export interface SharedTaskContext {
  owner: string | null;
  machine: string | null;
  repository: string | null;
}

export interface SharedTask {
  task: Task;
  evidence: Evidence[];
  project: string | null;
  owner: string | null;
  machine: string | null;
  repository: string | null;
  code: boolean;
}

export const SHARED_EVIDENCE_PREFIX = 'shared-evidence:';

const STORED_EVIDENCE = '/api/evidence/';

const PUBLIC_ADDRESS = /^https:\/\/(?!localhost\b|127\.|0\.0\.0\.0|\[::1\])[^/\s]+/i;

const SHINSA_LINK = /\[([^\]]*)\]\(shinsa:\/\/([a-z]+)\/[^)\s]*\)/g;

const SHINSA_URI = /shinsa:\/\/([a-z]+)\/[^\s)\]]*/g;

const SHARED_LINK_KINDS: ReadonlySet<string> = new Set(['file', 'pr', 'branch', 'repo']);

const CODE_STATES: ReadonlySet<PullRequest['state']> = new Set(['open', 'merged']);

const PRIVATE_ACTIVITY: ReadonlySet<ActivityKind> = new Set(['message', 'question', 'answer', 'account']);

const FINGERPRINT_CONTEXT: SharedTaskContext = { owner: null, machine: null, repository: '' };

function scrubText(text: string) {
  return text
    .replace(SHINSA_LINK, (link, label: string, kind: string) => (SHARED_LINK_KINDS.has(kind) ? link : label))
    .replace(SHINSA_URI, (uri, kind: string) => (SHARED_LINK_KINDS.has(kind) ? uri : ''));
}

function scrubValue<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as T;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item)])) as T;
}

function redactPhaseReport(report: PhaseReport): PhaseReport {
  return {
    index: report.index,
    runId: null,
    summary: report.summary,
    spots: report.spots,
    judgementCalls: report.judgementCalls,
    walkthrough: report.walkthrough ?? null,
    files: report.files ?? [],
    at: report.at,
  };
}

function redactPlan(plan: Plan): Plan {
  return {
    version: plan.version,
    body: plan.document ? serializePlanMarkdown(plan.document) : plan.body,
    document: plan.document,
    proposedAt: plan.proposedAt,
    changeSummary: plan.changeSummary ?? null,
    changes: plan.changes ?? [],
    feedback: null,
    approvedAt: plan.approvedAt ?? null,
  };
}

function redactFinding(finding: ReviewFinding): ReviewFinding {
  return {
    severity: finding.severity,
    file: finding.file,
    line: finding.line,
    end: finding.end ?? null,
    ...(finding.title ? { title: finding.title } : {}),
    message: finding.message,
    ...(finding.fix ? { fix: finding.fix } : {}),
    ...(finding.verdict ? { verdict: finding.verdict } : {}),
    verdictNote: finding.verdictNote ?? null,
  };
}

function redactPullRequest(pullRequest: PullRequest): PullRequest {
  return { ...pullRequest, unresolvedThreads: [] };
}

function redactRound(round: Round): Round {
  return { ...round, request: splitMessageAttachments(round.request).text };
}

function redactActivity(activity: readonly Activity[]): Activity[] {
  return activity
    .filter((entry) => !PRIVATE_ACTIVITY.has(entry.kind))
    .map((entry) => ({
      at: entry.at,
      actor: entry.actor,
      kind: entry.kind,
      text: entry.text,
      detail: entry.kind === 'decision' ? null : entry.detail,
      evidenceId: entry.evidenceId,
      runId: null,
      ...(entry.gateType ? { gateType: entry.gateType } : {}),
      ...(entry.onBehalf ? { onBehalf: entry.onBehalf } : {}),
      ...(entry.round ? { round: entry.round } : {}),
    }));
}

function redactTask(task: Task): Task {
  return {
    id: task.id,
    handle: task.handle ?? null,
    projectId: null,
    request: splitMessageAttachments(task.request).text,
    title: task.title,
    repoId: null,
    size: task.size,
    planFirst: task.planFirst,
    stage: task.stage,
    stageReason: task.stageReason,
    cancelledFrom: task.cancelledFrom ?? null,
    priority: task.priority,
    branch: task.branch,
    worktreePath: null,
    plan: task.plan ? redactPlan(task.plan) : null,
    phases: task.phases,
    planAnswers: null,
    summary: task.summary,
    report: task.report,
    reviewSummary: task.reviewSummary,
    findings: task.findings.map(redactFinding),
    fixRounds: task.fixRounds,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    recoveries: 0,
    phaseReports: task.phaseReports.map(redactPhaseReport),
    checks: task.checks ?? [],
    runningChecks: task.runningChecks ?? [],
    checkResults: task.checkResults ?? null,
    coverage: task.coverage ?? null,
    pullRequest: task.pullRequest ? redactPullRequest(task.pullRequest) : null,
    waitsOn: [],
    note: null,
    origin: null,
    createdAt: task.createdAt,
    updatedAt: task.stageChangedAt,
    stageChangedAt: task.stageChangedAt,
    activity: redactActivity(task.activity),
    ...(task.mode ? { mode: task.mode } : {}),
    reviewDisagreements: task.reviewDisagreements ?? [],
    ...(task.pipeline ? { pipeline: task.pipeline } : {}),
    auto: task.auto,
    result: task.result ? { ...task.result, runId: null } : null,
    proposal: task.proposal ? { ...task.proposal, runId: null } : null,
    rounds: (task.rounds ?? []).map(redactRound),
    closedAt: task.closedAt ?? null,
    mergeStepsDone: task.mergeStepsDone ?? [],
    carriedMergeSteps: task.carriedMergeSteps ?? [],
  };
}

function resolveSharedUri(evidence: Evidence) {
  if (evidence.kind === 'test' || evidence.kind === 'check') return evidence.uri;
  if (evidence.uri.startsWith(STORED_EVIDENCE)) return `${SHARED_EVIDENCE_PREFIX}${evidence.id}`;
  if (evidence.uploadUrl) return evidence.uploadUrl;
  return PUBLIC_ADDRESS.test(evidence.uri) ? evidence.uri : null;
}

function redactEvidence(evidence: Evidence): Evidence | null {
  const uri = resolveSharedUri(evidence);
  if (uri === null) return null;
  return {
    id: evidence.id,
    taskId: evidence.taskId,
    runId: null,
    kind: evidence.kind,
    title: scrubText(evidence.title),
    uri,
    attachedAt: evidence.attachedAt,
    ...(evidence.round ? { round: evidence.round } : {}),
    ...(evidence.detail ? { detail: scrubText(evidence.detail) } : {}),
    ...(evidence.width ? { width: evidence.width } : {}),
    ...(evidence.theme ? { theme: evidence.theme } : {}),
    ...(evidence.stage ? { stage: evidence.stage } : {}),
    ...(evidence.itemId ? { itemId: evidence.itemId } : {}),
    ...(evidence.label ? { label: scrubText(evidence.label) } : {}),
    ...(evidence.checkId ? { checkId: evidence.checkId } : {}),
    ...(evidence.key ? { key: evidence.key } : {}),
    ...(evidence.fixFor ? { fixFor: evidence.fixFor } : {}),
  };
}

function listSharedEvidence(state: ShinsaState, task: Task) {
  return Object.values(state.evidence)
    .filter((evidence) => evidence.taskId === task.id && isCurrentEvidence(evidence))
    .sort((left, right) => left.attachedAt - right.attachedAt)
    .flatMap((evidence) => redactEvidence(evidence) ?? []);
}

export function hasSharedCode(task: Task, repository: string | null) {
  if (repository === null) return false;
  return task.pullRequest !== null && CODE_STATES.has(task.pullRequest.state);
}

export function resolveSharedTask(state: ShinsaState, task: Task, context: SharedTaskContext): SharedTask {
  const projectId = resolveTaskProject(state, task);
  return {
    task: scrubValue(redactTask(task)),
    evidence: listSharedEvidence(state, task),
    project: projectId ? (state.projects[projectId]?.name ?? null) : null,
    owner: context.owner,
    machine: context.machine,
    repository: context.repository,
    code: hasSharedCode(task, context.repository),
  };
}

export function resolveSharedFingerprint(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (!task?.share) return null;
  return JSON.stringify(resolveSharedTask(state, task, FINGERPRINT_CONTEXT));
}
