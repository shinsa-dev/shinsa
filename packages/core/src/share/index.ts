import { splitMessageAttachments } from '../chat/attachments.ts';
import { isCurrentEvidence } from '../domain/evidence.ts';
import type { Round } from '../domain/rounds.ts';
import type { Evidence, PhaseReport, Plan, PullRequest, Task } from '../domain/types.ts';
import { serializePlanMarkdown } from '../report/markdown.ts';
import type {
  CodeSpot,
  JudgementCall,
  ReportCheck,
  ReportRisk,
  ReportWalkthrough,
  ReviewFinding,
  TaskCheck,
  WorkReport,
} from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';

export type RepositoryVisibility = 'public' | 'private' | 'unknown';

export interface SharedRepository {
  name: string;
  visibility: RepositoryVisibility;
}

export interface SharedTaskContext {
  owner: string | null;
  machine: string | null;
  repository: SharedRepository | null;
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

const PUBLIC_LINK_KINDS: ReadonlySet<string> = new Set(['file', 'pr', 'branch', 'repo']);

const CODE_STATES: ReadonlySet<PullRequest['state']> = new Set(['open', 'merged']);

const FINGERPRINT_CONTEXT: SharedTaskContext = {
  owner: null,
  machine: null,
  repository: { name: '', visibility: 'public' },
};

interface Redaction {
  paths: boolean;
}

function isLinkKept(kind: string, redaction: Redaction) {
  return redaction.paths && PUBLIC_LINK_KINDS.has(kind);
}

function scrubText(text: string, redaction: Redaction) {
  return text
    .replace(SHINSA_LINK, (link, label: string, kind: string) => (isLinkKept(kind, redaction) ? link : label))
    .replace(SHINSA_URI, (uri, kind: string) => (isLinkKept(kind, redaction) ? uri : ''));
}

function scrubValue<T>(value: T, redaction: Redaction): T {
  if (typeof value === 'string') return scrubText(value, redaction) as T;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, redaction)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, scrubValue(item, redaction)])
  ) as T;
}

function redactSpot(spot: CodeSpot, redaction: Redaction): CodeSpot {
  if (redaction.paths) return spot;
  return { ...spot, file: '', start: 0, end: 0 };
}

function redactCall(call: JudgementCall, redaction: Redaction): JudgementCall {
  if (redaction.paths) return call;
  return { ...call, file: null, line: null, end: null };
}

function redactRisk(risk: ReportRisk, redaction: Redaction): ReportRisk {
  if (redaction.paths) return risk;
  return { ...risk, file: null, line: null, end: null };
}

function redactWalkthrough(walkthrough: ReportWalkthrough, redaction: Redaction): ReportWalkthrough {
  return {
    approach: walkthrough.approach,
    flow: walkthrough.flow,
    risks: walkthrough.risks.map((risk) => redactRisk(risk, redaction)),
    testing: {
      automated: walkthrough.testing.automated,
      manual: walkthrough.testing.manual.map((step) => ({
        action: step.action,
        expect: step.expect,
        target: step.target?.kind === 'url' && PUBLIC_ADDRESS.test(step.target.value) ? step.target : null,
      })),
    },
    steps: (walkthrough.steps ?? []).map((step) => ({
      ...step,
      command: redaction.paths ? step.command : null,
    })),
    watchdogs: [],
  };
}

function redactCheck(check: ReportCheck, redaction: Redaction): ReportCheck {
  return {
    id: check.id,
    label: check.label,
    command: redaction.paths ? check.command : '',
    outcome: check.outcome,
    detail: null,
    ...(check.note ? { note: check.note } : {}),
  };
}

function redactTaskCheck(check: TaskCheck, redaction: Redaction): TaskCheck {
  return { ...check, command: redaction.paths ? check.command : '' };
}

function redactReport(report: WorkReport, redaction: Redaction): WorkReport {
  return {
    headline: report.headline,
    sections: report.sections.map((section) => ({
      title: section.title,
      summary: section.summary,
      spots: section.spots.map((spot) => redactSpot(spot, redaction)),
    })),
    checks: report.checks.map((check) => redactCheck(check, redaction)),
    judgementCalls: report.judgementCalls.map((call) => redactCall(call, redaction)),
    walkthrough: report.walkthrough ? redactWalkthrough(report.walkthrough, redaction) : null,
  };
}

function redactPhaseReport(report: PhaseReport, redaction: Redaction): PhaseReport {
  return {
    index: report.index,
    runId: null,
    summary: report.summary,
    spots: report.spots.map((spot) => redactSpot(spot, redaction)),
    judgementCalls: report.judgementCalls.map((call) => redactCall(call, redaction)),
    walkthrough: report.walkthrough ? redactWalkthrough(report.walkthrough, redaction) : null,
    files: redaction.paths ? (report.files ?? []) : [],
    at: report.at,
  };
}

function redactPlan(plan: Plan, redaction: Redaction): Plan {
  const source = plan.document;
  const document = source && {
    ...source,
    files: redaction.paths ? source.files : [],
    verification: source.verification.map((check) => ({
      ...check,
      command: redaction.paths ? check.command : '',
    })),
  };
  return {
    version: plan.version,
    body: document ? serializePlanMarkdown(document) : plan.body,
    document,
    proposedAt: plan.proposedAt,
    changeSummary: plan.changeSummary ?? null,
    changes: (plan.changes ?? []).filter((change) => redaction.paths || change.kind !== 'files'),
    feedback: null,
    approvedAt: plan.approvedAt ?? null,
  };
}

function redactFinding(finding: ReviewFinding, redaction: Redaction): ReviewFinding {
  const located = redaction.paths
    ? { file: finding.file, line: finding.line, end: finding.end ?? null }
    : { file: null, line: null, end: null };
  return {
    severity: finding.severity,
    ...located,
    ...(finding.title ? { title: finding.title } : {}),
    message: finding.message,
    ...(finding.fix ? { fix: finding.fix } : {}),
    ...(finding.verdict ? { verdict: finding.verdict } : {}),
    verdictNote: null,
  };
}

function redactPullRequest(pullRequest: PullRequest, redaction: Redaction): PullRequest {
  return {
    number: pullRequest.number,
    url: redaction.paths ? pullRequest.url : '',
    state: pullRequest.state,
    checks: pullRequest.checks,
    unresolvedComments: pullRequest.unresolvedComments,
    mergeable: pullRequest.mergeable,
    headSha: redaction.paths ? (pullRequest.headSha ?? null) : null,
    updatedAt: pullRequest.updatedAt,
    checkRuns: (pullRequest.checkRuns ?? []).map((run) => ({
      ...run,
      url: redaction.paths ? run.url : null,
    })),
    unresolvedThreads: [],
    mergeCommit: redaction.paths ? (pullRequest.mergeCommit ?? null) : null,
    changes: pullRequest.changes ?? null,
  };
}

function redactRound(round: Round, redaction: Redaction): Round {
  const pullRequest = round.pullRequest && {
    ...round.pullRequest,
    url: redaction.paths ? round.pullRequest.url : '',
    base: redaction.paths ? round.pullRequest.base : null,
  };
  return {
    ...round,
    request: splitMessageAttachments(round.request).text,
    base: redaction.paths ? round.base : null,
    branch: redaction.paths ? round.branch : null,
    pullRequest,
  };
}

function redactTask(task: Task, redaction: Redaction): Task {
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
    branch: redaction.paths ? task.branch : null,
    worktreePath: null,
    plan: task.plan ? redactPlan(task.plan, redaction) : null,
    phases: task.phases,
    planAnswers: null,
    summary: task.summary,
    report: task.report ? redactReport(task.report, redaction) : null,
    reviewSummary: task.reviewSummary,
    findings: task.findings.map((finding) => redactFinding(finding, redaction)),
    fixRounds: task.fixRounds,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    recoveries: 0,
    phaseReports: task.phaseReports.map((report) => redactPhaseReport(report, redaction)),
    checks: (task.checks ?? []).map((check) => redactTaskCheck(check, redaction)),
    runningChecks: task.runningChecks ?? [],
    checkResults: task.checkResults?.map((check) => redactCheck(check, redaction)) ?? null,
    coverage: redaction.paths ? (task.coverage ?? null) : null,
    pullRequest: task.pullRequest ? redactPullRequest(task.pullRequest, redaction) : null,
    waitsOn: [],
    note: null,
    origin: null,
    createdAt: task.createdAt,
    updatedAt: task.stageChangedAt,
    stageChangedAt: task.stageChangedAt,
    activity: [],
    ...(task.mode ? { mode: task.mode } : {}),
    reviewDisagreements: task.reviewDisagreements ?? [],
    ...(task.pipeline ? { pipeline: task.pipeline } : {}),
    auto: task.auto,
    result: task.result ? { ...task.result, runId: null } : null,
    proposal: task.proposal ? { ...task.proposal, runId: null } : null,
    rounds: (task.rounds ?? []).map((round) => redactRound(round, redaction)),
    closedAt: task.closedAt ?? null,
    mergeStepsDone: task.mergeStepsDone ?? [],
    carriedMergeSteps: (task.carriedMergeSteps ?? []).map((step) => ({
      ...step,
      command: redaction.paths ? step.command : null,
    })),
  };
}

function resolveSharedUri(evidence: Evidence) {
  if (evidence.kind === 'test' || evidence.kind === 'check') return evidence.uri;
  if (evidence.uri.startsWith(STORED_EVIDENCE)) return `${SHARED_EVIDENCE_PREFIX}${evidence.id}`;
  if (evidence.uploadUrl) return evidence.uploadUrl;
  return PUBLIC_ADDRESS.test(evidence.uri) ? evidence.uri : null;
}

function redactEvidence(evidence: Evidence, redaction: Redaction): Evidence | null {
  const uri = resolveSharedUri(evidence);
  if (uri === null) return null;
  return {
    id: evidence.id,
    taskId: evidence.taskId,
    runId: null,
    kind: evidence.kind,
    title: scrubText(evidence.title, redaction),
    uri,
    attachedAt: evidence.attachedAt,
    ...(evidence.round ? { round: evidence.round } : {}),
    ...(evidence.detail ? { detail: scrubText(evidence.detail, redaction) } : {}),
    ...(evidence.width ? { width: evidence.width } : {}),
    ...(evidence.theme ? { theme: evidence.theme } : {}),
    ...(evidence.stage ? { stage: evidence.stage } : {}),
    ...(evidence.itemId ? { itemId: evidence.itemId } : {}),
    ...(evidence.label ? { label: scrubText(evidence.label, redaction) } : {}),
    ...(evidence.checkId ? { checkId: evidence.checkId } : {}),
    ...(evidence.key ? { key: evidence.key } : {}),
    ...(evidence.fixFor ? { fixFor: evidence.fixFor } : {}),
  };
}

function listSharedEvidence(state: ShinsaState, task: Task, redaction: Redaction) {
  return Object.values(state.evidence)
    .filter((evidence) => evidence.taskId === task.id && isCurrentEvidence(evidence))
    .sort((left, right) => left.attachedAt - right.attachedAt)
    .flatMap((evidence) => redactEvidence(evidence, redaction) ?? []);
}

export function hasSharedCode(task: Task, repository: SharedRepository | null) {
  if (repository?.visibility !== 'public') return false;
  return task.pullRequest !== null && CODE_STATES.has(task.pullRequest.state);
}

export function resolveSharedTask(state: ShinsaState, task: Task, context: SharedTaskContext): SharedTask {
  const publicRepository = context.repository?.visibility === 'public' ? context.repository : null;
  const redaction: Redaction = { paths: publicRepository !== null };
  const projectId = resolveTaskProject(state, task);
  return {
    task: scrubValue(redactTask(task, redaction), redaction),
    evidence: listSharedEvidence(state, task, redaction),
    project: projectId ? (state.projects[projectId]?.name ?? null) : null,
    owner: context.owner,
    machine: context.machine,
    repository: publicRepository?.name ?? null,
    code: hasSharedCode(task, context.repository),
  };
}

export function resolveSharedFingerprint(state: ShinsaState, taskId: string) {
  const task = state.tasks[taskId];
  if (!task?.share) return null;
  return JSON.stringify(resolveSharedTask(state, task, FINGERPRINT_CONTEXT));
}
