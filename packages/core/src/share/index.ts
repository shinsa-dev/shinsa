import { splitMessageAttachments } from '../chat/attachments.ts';
import type { RunDelegation } from '../domain/delegations.ts';
import { isCurrentEvidence } from '../domain/evidence.ts';
import type { Round } from '../domain/rounds.ts';
import type { SharePreset } from '../domain/settings.ts';
import type { ChangeProposal, TaskResult } from '../domain/shapes.ts';
import type {
  Activity,
  ActivityKind,
  Evidence,
  Gate,
  PhaseReport,
  Plan,
  Project,
  PullRequest,
  Repo,
  Run,
  Task,
} from '../domain/types.ts';
import { serializePlanMarkdown } from '../report/markdown.ts';
import type { PlanDocument, ReviewFinding, WorkReport } from '../report/types.ts';
import type { ShinsaState } from '../state/project.ts';
import { resolveTaskProject } from '../state/queries.ts';
import { hasShareGroup, SHARE_PRESET_GROUPS, type ShareGroup } from './presets.ts';
import { resolveShareUpdate, type ShareUpdate } from './update.ts';

export interface SharedTaskContext {
  preset: SharePreset;
  owner: string | null;
  machine: string | null;
  repository: string | null;
}

export interface SharedTask {
  preset: SharePreset;
  task: Task;
  gates: Gate[];
  runs: Run[];
  evidence: Evidence[];
  repo: Repo | null;
  project: Project | null;
  owner: string | null;
  machine: string | null;
  repository: string | null;
  description: string | null;
  update: ShareUpdate | null;
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

function scrubText(text: string, kept: ReadonlySet<string>) {
  return text
    .replace(SHINSA_LINK, (link, label: string, kind: string) => (kept.has(kind) ? link : label))
    .replace(SHINSA_URI, (uri, kind: string) => (kept.has(kind) ? uri : ''));
}

function scrubValue<T>(value: T, kept: ReadonlySet<string>): T {
  if (typeof value === 'string') return scrubText(value, kept) as T;
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, kept)) as T;
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item, kept)])) as T;
}

type Grants = (group: ShareGroup) => boolean;

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

function redactPlanPhases(document: PlanDocument): PlanDocument {
  return {
    goal: '',
    phases: document.phases.map((phase) => ({ title: phase.title, detail: '' })),
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [],
    questions: [],
  };
}

function redactProgressPlan(plan: Plan): Plan {
  return {
    version: plan.version,
    body: '',
    document: plan.document ? redactPlanPhases(plan.document) : null,
    proposedAt: plan.proposedAt,
    changeSummary: null,
    changes: [],
    feedback: null,
    approvedAt: plan.approvedAt ?? null,
  };
}

function resolveSharedPlan(plan: Plan | null, grants: Grants) {
  if (!plan) return null;
  if (grants('plan')) return redactPlan(plan);
  return grants('progress') ? redactProgressPlan(plan) : null;
}

function resolveSharedReport(report: WorkReport | null, grants: Grants): WorkReport | null {
  return report && grants('reports') ? report : null;
}

function resolveSharedResult(result: TaskResult | null | undefined, grants: Grants): TaskResult | null {
  if (!result || !(grants('progress') || grants('summary'))) return null;
  return { step: result.step, body: grants('summary') ? result.body : '', runId: null, at: result.at };
}

function resolveSharedProposal(proposal: ChangeProposal | null | undefined, grants: Grants) {
  if (!proposal) return null;
  if (grants('plan')) return { ...proposal, runId: null };
  return grants('progress') ? { ...proposal, request: '', why: '', runId: null } : null;
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
  };
}

function redactPullRequest(pullRequest: PullRequest): PullRequest {
  return { ...pullRequest, unresolvedThreads: [] };
}

function redactRound(round: Round, grants: Grants): Round {
  const outcome = round.outcome;
  return {
    number: round.number,
    title: grants('identity') ? round.title : '',
    request: grants('requests') ? splitMessageAttachments(round.request).text : '',
    why: grants('requests') ? round.why : null,
    shipping: round.shipping,
    status: round.status,
    pipeline: round.pipeline,
    branch: grants('people') ? round.branch : null,
    base: grants('people') ? round.base : null,
    pullRequest: grants('pull_request') ? round.pullRequest : null,
    queuedAt: round.queuedAt,
    startedAt: round.startedAt,
    endedAt: round.endedAt,
    outcome: outcome
      ? {
          goal: grants('plan') ? outcome.goal : null,
          phases: outcome.phases,
          headline: grants('summary') ? outcome.headline : null,
          result: grants('summary') ? outcome.result : null,
        }
      : null,
  };
}

function isSharedActivity(entry: Activity, grants: Grants) {
  return !PRIVATE_ACTIVITY.has(entry.kind) || (entry.kind === 'message' && grants('messages'));
}

function resolveSharedDetail(entry: Activity) {
  if (entry.kind === 'decision' || entry.detail === null) return null;
  return splitMessageAttachments(entry.detail).text;
}

function redactActivity(activity: readonly Activity[], grants: Grants): Activity[] {
  return activity
    .filter((entry) => isSharedActivity(entry, grants))
    .map((entry) => ({
      at: entry.at,
      actor: entry.actor,
      kind: entry.kind,
      text: entry.text,
      detail: resolveSharedDetail(entry),
      evidenceId: entry.evidenceId,
      runId: null,
      ...(entry.gateType ? { gateType: entry.gateType } : {}),
      ...(entry.onBehalf ? { onBehalf: entry.onBehalf } : {}),
      ...(entry.round ? { round: entry.round } : {}),
    }));
}

function createBlankTask(task: Task, grants: Grants): Task {
  return {
    id: task.id,
    handle: null,
    projectId: null,
    request: '',
    title: '',
    repoId: null,
    size: null,
    planFirst: task.planFirst,
    stage: task.stage,
    stageReason: '',
    cancelledFrom: null,
    priority: task.priority,
    branch: null,
    worktreePath: null,
    plan: resolveSharedPlan(task.plan, grants),
    phases: [],
    planAnswers: null,
    summary: null,
    report: resolveSharedReport(task.report, grants),
    reviewSummary: null,
    findings: [],
    fixRounds: 0,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    pushedSha: null,
    pushedAt: null,
    recoveries: 0,
    phaseReports: [],
    checks: [],
    runningChecks: [],
    checkResults: null,
    coverage: null,
    pullRequest: null,
    waitsOn: [],
    note: null,
    origin: null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    stageChangedAt: task.stageChangedAt,
    activity: [],
    ...(task.mode ? { mode: task.mode } : {}),
    reviewDisagreements: [],
    monitor: null,
    suggestions: [],
    usageWait: null,
    triageDecisions: null,
    auto: task.auto,
    result: resolveSharedResult(task.result, grants),
    proposal: resolveSharedProposal(task.proposal, grants),
    rounds: (task.rounds ?? []).map((round) => redactRound(round, grants)),
    closedAt: task.closedAt ?? null,
    mergeStepsDone: [],
    carriedMergeSteps: [],
    watchdogs: [],
  };
}

const TASK_GROUP_FIELDS: Partial<Record<ShareGroup, (task: Task, grants: Grants) => Partial<Task>>> = {
  identity: (task) => ({ handle: task.handle ?? null, title: task.title, size: task.size }),
  requests: (task) => ({ request: splitMessageAttachments(task.request).text }),
  progress: (task) => ({
    cancelledFrom: task.cancelledFrom ?? null,
    phases: task.phases,
    ...(task.pipeline ? { pipeline: task.pipeline } : {}),
  }),
  summary: (task) => ({ summary: task.summary }),
  people: (task) => ({
    projectId: task.projectId ?? null,
    repoId: task.repoId,
    branch: task.branch,
    stageReason: task.stageReason,
  }),
  plan: (task) => ({ triageDecisions: task.triageDecisions ?? null }),
  reports: (task) => ({ phaseReports: task.phaseReports.map(redactPhaseReport), fixRounds: task.fixRounds }),
  review: (task) => ({
    reviewSummary: task.reviewSummary,
    findings: task.findings.map(redactFinding),
    reviewDisagreements: task.reviewDisagreements ?? [],
  }),
  checks: (task) => ({
    checks: task.checks ?? [],
    runningChecks: task.runningChecks ?? [],
    checkResults: task.checkResults ?? null,
    coverage: task.coverage ?? null,
  }),
  pull_request: (task) => ({
    pullRequest: task.pullRequest ? redactPullRequest(task.pullRequest) : null,
    pushedSha: task.pushedSha ?? null,
    pushedAt: task.pushedAt ?? null,
    mergeStepsDone: task.mergeStepsDone ?? [],
    carriedMergeSteps: task.carriedMergeSteps ?? [],
    watchdogs: (task.watchdogs ?? []).map((watchdog) => ({ ...watchdog })),
  }),
  activity: (task, grants) => ({
    activity: redactActivity(task.activity, grants),
    monitor: task.monitor ? { ...task.monitor } : null,
    suggestions: (task.suggestions ?? []).map((suggestion) => ({ ...suggestion })),
    usageWait: task.usageWait ? { ...task.usageWait, account: null } : null,
  }),
};

function redactTask(task: Task, preset: SharePreset, grants: Grants): Task {
  const parts = SHARE_PRESET_GROUPS[preset].map((group) => TASK_GROUP_FIELDS[group]?.(task, grants) ?? {});
  return Object.assign(createBlankTask(task, grants), ...parts);
}

function redactGate(gate: Gate): Gate {
  return {
    id: gate.id,
    taskId: gate.taskId,
    type: gate.type,
    status: gate.status,
    title: gate.title,
    body: gate.body,
    runId: gate.runId,
    openedAt: gate.openedAt,
    answeredAt: gate.answeredAt,
    decision: gate.decision,
    response: null,
    ...(gate.planVersion ? { planVersion: gate.planVersion } : {}),
    ...(gate.choices ? { choices: gate.choices } : {}),
    ...(gate.recommendation ? { recommendation: gate.recommendation } : {}),
    ...(gate.cause ? { cause: gate.cause } : {}),
    ...(gate.escalation ? { escalation: gate.escalation } : {}),
    ...(gate.round ? { round: gate.round } : {}),
  };
}

function redactRun(run: Run): Run {
  return {
    id: run.id,
    taskId: run.taskId,
    role: run.role,
    ...(run.purpose ? { purpose: run.purpose } : {}),
    ...(run.status ? { status: run.status } : {}),
    phaseIndex: run.phaseIndex ?? null,
    provider: run.provider,
    model: run.model,
    sessionId: null,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    outcome: run.outcome,
    summary: null,
    ...(run.usage ? { usage: run.usage } : {}),
    ...(run.delegation ? { delegation: redactDelegation(run.delegation) } : {}),
    ...(run.waitingOn ? { waitingOn: run.waitingOn } : {}),
    ...(run.round ? { round: run.round } : {}),
  };
}

function redactDelegation(delegation: RunDelegation): RunDelegation {
  const question = delegation.question;
  return {
    ...delegation,
    brief: '',
    question: question
      ? {
          ...question,
          question: '',
          context: null,
          choices: [],
          recommendation: null,
          answer: question.answer === null ? null : '',
        }
      : null,
  };
}

function redactRepo(repo: Repo): Repo {
  return {
    id: repo.id,
    name: repo.name,
    path: '',
    defaultBranch: repo.defaultBranch,
    remote: repo.remote,
    projectId: repo.projectId,
    checkCommands: repo.checkCommands,
  };
}

function redactProject(project: Project): Project {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    key: project.key,
    description: '',
    folders: [],
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
    title: scrubText(evidence.title, SHARED_LINK_KINDS),
    uri,
    attachedAt: evidence.attachedAt,
    ...(evidence.round ? { round: evidence.round } : {}),
    ...(evidence.detail ? { detail: scrubText(evidence.detail, SHARED_LINK_KINDS) } : {}),
    ...(evidence.width ? { width: evidence.width } : {}),
    ...(evidence.theme ? { theme: evidence.theme } : {}),
    ...(evidence.stage ? { stage: evidence.stage } : {}),
    ...(evidence.itemId ? { itemId: evidence.itemId } : {}),
    ...(evidence.label ? { label: scrubText(evidence.label, SHARED_LINK_KINDS) } : {}),
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
  if (task.pullRequest !== null && CODE_STATES.has(task.pullRequest.state)) return true;
  return Boolean(task.worktreePath);
}

export function resolveSharedTask(state: ShinsaState, task: Task, context: SharedTaskContext): SharedTask {
  const grants: Grants = (group) => hasShareGroup(context.preset, group);
  const people = grants('people');
  const projectId = resolveTaskProject(state, task);
  const project = people && projectId ? state.projects[projectId] : undefined;
  const repo = people && task.repoId ? state.repos[task.repoId] : undefined;
  const links = people ? SHARED_LINK_KINDS : new Set<string>();
  return {
    preset: context.preset,
    task: scrubValue(redactTask(task, context.preset, grants), links),
    gates: grants('activity')
      ? Object.values(state.gates)
          .filter((gate) => gate.taskId === task.id)
          .map((gate) => scrubValue(redactGate(gate), links))
      : [],
    runs: grants('runs')
      ? Object.values(state.runs)
          .filter((run) => run.taskId === task.id)
          .map(redactRun)
      : [],
    evidence: grants('evidence') ? listSharedEvidence(state, task) : [],
    repo: repo ? redactRepo(repo) : null,
    project: project ? redactProject(project) : null,
    owner: people ? context.owner : null,
    machine: people ? context.machine : null,
    repository: people ? context.repository : null,
    description: grants('description') ? scrubText(task.share?.description ?? '', links) || null : null,
    update: grants('progress') ? resolveShareUpdate(task) : null,
    code: grants('code') && hasSharedCode(task, context.repository),
  };
}
