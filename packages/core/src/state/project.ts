import type { StoredBriefing } from '../briefing/types.ts';
import {
  createSettings,
  type Evidence,
  type Focus,
  formatTaskHandle,
  type Gate,
  NO_PROJECT_KEY,
  needsWorktree,
  type OnBehalfAction,
  type Project,
  parseTaskHandle,
  type Repo,
  type Run,
  type RunUsage,
  resolveProjectKey,
  resolveShapeOf,
  resolveTaskPipeline,
  type Schedule,
  SETTINGS_KEYS,
  type Settings,
  SHAPE_PIPELINES,
  type Task,
  type TaskShape,
} from '../domain/index.ts';
import type { EventOf, LegacyArea, ShinsaEvent, StoredFocus, StoredRepo } from '../events/index.ts';
import { resolvePlanChanges } from '../report/plan-changes.ts';
import { applyAccountBound } from './accounts.ts';
import {
  describeChecks,
  describeDependencies,
  describeEscalation,
  describeFailedChecks,
  describeFindings,
  describeFixRound,
  describeStage,
} from './activity.ts';
import { applyDelegationEvent, recordCourierTask, resolveLineage } from './delegations.ts';
import { applyGateEvent } from './gates.ts';
import { applyOnBehalfActed } from './on-behalf.ts';
import { applyPullRequestEvent } from './pull-requests.ts';
import { applyRoundEvent, createFirstRound, recordRoundBranch, recordRoundStaged } from './rounds.ts';
import { applyRunEvent } from './runs.ts';
import { applyScheduledTask, applyScheduleEvent, describeSchedule } from './schedules.ts';
import { applyShapeEvent, describeShape } from './shapes.ts';
import { applySuggested, applySuggestionSettled } from './suggestions.ts';
import { applyWaitEvent } from './waits.ts';
import { applyOnBehalf, record, updateTask } from './write.ts';

export interface ShinsaState {
  seq: number;
  repos: Record<string, Repo>;
  projects: Record<string, Project>;
  focus: Focus;
  taskNumbers: Record<string, number>;
  settings: Settings;
  tasks: Record<string, Task>;
  runs: Record<string, Run>;
  gates: Record<string, Gate>;
  evidence: Record<string, Evidence>;
  briefings: Record<string, StoredBriefing>;
  schedules: Record<string, Schedule>;
  sessionUsage: Record<string, RunUsage>;
  onBehalfActions: OnBehalfAction[];
}

const UNTITLED_LENGTH = 80;

const PLAN_HISTORY_LIMIT = 10;

export function createState(): ShinsaState {
  return {
    seq: 0,
    repos: {},
    projects: {},
    focus: { projectId: null, until: null },
    taskNumbers: {},
    settings: createSettings(),
    tasks: {},
    runs: {},
    gates: {},
    evidence: {},
    briefings: {},
    schedules: {},
    sessionUsage: {},
    onBehalfActions: [],
  };
}

export function briefingKey(projectId: string | null) {
  return projectId ?? '*';
}

function readRepo(stored: StoredRepo): Repo {
  const { areaId, projectId, previewCommand, ...repo } = stored;
  return { ...repo, projectId: projectId ?? areaId ?? null };
}

function readFocus(stored: StoredFocus): Focus {
  return { projectId: stored.projectId ?? stored.areaId ?? null, until: stored.until };
}

function listOtherKeys(state: ShinsaState, projectId: string) {
  return Object.values(state.projects)
    .filter((project) => project.id !== projectId)
    .map((project) => project.key);
}

function applyAreaWritten(state: ShinsaState, area: LegacyArea) {
  const existing = state.projects[area.id];
  state.projects[area.id] = {
    id: area.id,
    name: area.name,
    color: area.color,
    key: existing?.key ?? resolveProjectKey(area.name, listOtherKeys(state, area.id)),
    description: existing?.description ?? '',
    folders: existing?.folders ?? [],
  };
}

function recordHandle(state: ShinsaState, handle: string) {
  const parsed = parseTaskHandle(handle);
  if (!parsed) return;
  const [key = NO_PROJECT_KEY, number = '0'] = parsed.split('-');
  state.taskNumbers[key] = Math.max(state.taskNumbers[key] ?? 0, Number(number));
}

export function resolveNextHandle(state: ShinsaState, projectId: string | null) {
  const key = (projectId ? state.projects[projectId]?.key : undefined) ?? NO_PROJECT_KEY;
  return formatTaskHandle(key, (state.taskNumbers[key] ?? 0) + 1);
}

function resolveCreatedShape(event: EventOf<'task.created'>): TaskShape {
  if (event.shape) return event.shape;
  return event.mode === 'ask' ? 'answer' : 'change';
}

function createTask(event: EventOf<'task.created'>): Task {
  const title = event.request.split('\n', 1)[0]?.slice(0, UNTITLED_LENGTH) ?? '';
  const pipeline = [
    ...resolveTaskPipeline({
      ...(event.shape ? { pipeline: [...SHAPE_PIPELINES[event.shape]] } : {}),
      ...(event.mode ? { mode: event.mode } : {}),
    }),
  ];
  return {
    id: event.taskId,
    handle: event.handle ?? null,
    projectId: event.projectId ?? null,
    request: event.request,
    title,
    repoId: event.repoId,
    size: null,
    planFirst: event.planFirst ?? false,
    stage: 'triage',
    stageReason: 'sizing up the work',
    priority: event.priority,
    branch: null,
    worktreePath: null,
    plan: null,
    phases: [],
    planAnswers: null,
    summary: null,
    report: null,
    findings: [],
    fixRounds: 0,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    recoveries: 0,
    phaseReports: [],
    checkResults: null,
    pullRequest: null,
    baseTaskId: null,
    waitsOn: [],
    note: null,
    origin: event.origin ?? null,
    createdAt: event.at,
    updatedAt: event.at,
    stageChangedAt: event.at,
    activity: [
      {
        at: event.at,
        actor: 'you',
        kind: 'asked',
        text: resolveCreatedShape(event) === 'answer' ? 'Asked a question' : 'Asked for this',
        detail: event.request,
        evidenceId: null,
        ...(event.onBehalf ? { onBehalf: true } : {}),
        ...(event.byTask ? { byTask: event.byTask } : {}),
      },
    ],
    ...(event.mode === 'ask' ? { mode: 'ask' as const } : {}),
    ...(event.shape ? { pipeline: [...SHAPE_PIPELINES[event.shape]] } : {}),
    ...(event.auto ? { auto: { ...event.auto } } : {}),
    ...(event.account ? { account: event.account } : {}),
    rounds: [createFirstRound(title, event.request, pipeline, event.at)],
  };
}

function resolveWrittenIdleCompaction(previous: boolean | undefined, written: boolean | undefined) {
  return written === true && previous === undefined ? undefined : written;
}

function readSettings(stored: Settings): Settings {
  const known = SETTINGS_KEYS.filter((key) => key in stored).map((key) => [key, stored[key]]);
  return Object.fromEntries(known) as Settings;
}

function applySettingsChanged(state: ShinsaState, event: EventOf<'settings.changed'>) {
  const settings = readSettings(event.settings);
  if ('compaction' in settings) {
    state.settings = settings;
    return;
  }
  const { idleCompaction, ...rest } = settings;
  const defaults = createSettings();
  const kept = resolveWrittenIdleCompaction(state.settings.idleCompaction, idleCompaction);
  state.settings = {
    compaction: defaults.compaction,
    fastMode: defaults.fastMode,
    ...rest,
    ...(kept === undefined ? {} : { idleCompaction: kept }),
  };
}

function describeSetUp(state: ShinsaState, event: EventOf<'task.triaged'>, shape: TaskShape) {
  const repo = state.repos[event.repoId]?.name ?? 'the repository';
  if (shape === 'change') return `Set up as a ${event.size} change on ${event.branch}`;
  if (shape === 'answer') return `Set up as a question about ${repo}`;
  return `Set up as ${describeShape(shape)} in ${repo}`;
}

function applyTriaged(state: ShinsaState, event: EventOf<'task.triaged'>) {
  const task = state.tasks[event.taskId];
  const baseTaskId = event.baseTaskId ?? null;
  const pipeline = event.pipeline ?? (task ? [...resolveTaskPipeline(task)] : []);
  const worktree = needsWorktree(pipeline);
  const waitsOn = task?.waitsOn ?? [];
  const projectId = task?.projectId ?? event.projectId ?? state.repos[event.repoId]?.projectId ?? null;
  const handle = task?.handle ?? event.handle ?? resolveNextHandle(state, projectId);
  if (task && !task.handle) recordHandle(state, handle);
  updateTask(state, event.taskId, event.at, {
    title: event.title,
    repoId: event.repoId,
    projectId,
    handle,
    size: event.size,
    branch: worktree ? event.branch : null,
    baseTaskId,
    waitsOn: baseTaskId && !waitsOn.includes(baseTaskId) ? [...waitsOn, baseTaskId] : waitsOn,
    ...(event.pipeline ? { pipeline: event.pipeline } : {}),
    ...(worktree ? {} : { proposedBranch: event.branch }),
    ...(event.decisions ? { triageDecisions: event.decisions } : {}),
    rounds: (task?.rounds ?? []).map((round) =>
      round.number === 1 ? { ...round, title: event.title, pipeline: [...pipeline] } : round
    ),
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'set_up',
    text: describeSetUp(state, event, resolveShapeOf(pipeline)),
  });
}

function applyStaged(state: ShinsaState, event: EventOf<'task.staged'>) {
  const previous = state.tasks[event.taskId]?.stage;
  updateTask(state, event.taskId, event.at, {
    stage: event.stage,
    stageReason: event.reason,
    stageChangedAt: event.at,
  });
  const answered = previous === 'answering' && event.stage === 'done';
  const text = answered ? null : describeStage(event.stage);
  if (text && previous !== event.stage) {
    record(state, event.taskId, event.at, { actor: event.by ?? 'shinsa', kind: 'stage', text });
  }
  recordRoundStaged(state, event.taskId, event.stage, event.by, event.at);
}

function applyPrioritized(state: ShinsaState, event: EventOf<'task.prioritized'>) {
  updateTask(state, event.taskId, event.at, { priority: event.priority });
  if (event.by !== 'you') return;
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'stage',
    text: `Set the priority to ${event.priority}`,
  });
}

function applyWaitsOnChanged(state: ShinsaState, event: EventOf<'task.waits_on_changed'>) {
  updateTask(state, event.taskId, event.at, { waitsOn: event.waitsOn });
  const titles = event.waitsOn.map((id) => state.tasks[id]?.title ?? 'another task');
  record(state, event.taskId, event.at, {
    actor: event.by ?? 'you',
    kind: 'stage',
    text: describeDependencies(titles),
  });
}

function listPlanHistory(task: Task | undefined) {
  const previous = task?.plan;
  if (!previous) return task?.planHistory ?? [];
  const { approvedAt: _approvedAt, ...revision } = previous;
  return [...(task.planHistory ?? []), revision].slice(-PLAN_HISTORY_LIMIT);
}

function applyPlanProposed(state: ShinsaState, event: EventOf<'plan.proposed'>) {
  const task = state.tasks[event.taskId];
  const previous = task?.plan ?? null;
  const version = (previous?.version ?? 0) + 1;
  const document = event.document ?? null;
  const revision =
    previous === null
      ? {}
      : {
          changeSummary: event.changeSummary ?? null,
          changes: resolvePlanChanges(previous.document, document),
          feedback: event.feedback ?? null,
        };
  updateTask(state, event.taskId, event.at, {
    plan: { version, body: event.body, document, proposedAt: event.at, ...revision },
    phases: (event.document?.phases ?? []).map(() => ({ status: 'pending' as const, at: event.at })),
    ...(previous === null ? {} : { planHistory: listPlanHistory(task) }),
  });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'plan',
    text: version === 1 ? 'Proposed a plan' : `Revised the plan (version ${version})`,
    detail: (version > 1 ? event.changeSummary : null) ?? event.document?.goal ?? null,
  });
}

function applyPhaseUpdated(state: ShinsaState, event: EventOf<'phase.updated'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const phases = task.phases.map((phase, index) =>
    index === event.index ? { status: event.status, at: event.at } : phase
  );
  updateTask(state, event.taskId, event.at, { phases });
}

function applyPhaseCompleted(state: ShinsaState, event: EventOf<'phase.completed'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const phaseReports = [
    ...task.phaseReports.filter((report) => report.index !== event.report.index),
    event.report,
  ];
  updateTask(state, event.taskId, event.at, { phaseReports });
  const title = task.plan?.document?.phases[event.report.index]?.title ?? `phase ${event.report.index + 1}`;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'work',
    text: `Finished: ${title}`,
    detail: event.report.summary,
    runId: event.report.runId ?? null,
  });
}

function listFixFingerprints(task: Task | undefined, event: EventOf<'fix.started'>) {
  if (event.round === 0) return [];
  const fingerprints = task?.fixFingerprints ?? [];
  if (event.treeHash === undefined || !event.reason) return fingerprints;
  return [
    ...fingerprints,
    { reason: event.reason, signature: event.signature ?? null, treeHash: event.treeHash },
  ];
}

function applyFixStarted(state: ShinsaState, event: EventOf<'fix.started'>) {
  const task = state.tasks[event.taskId];
  const history = task?.fixHistory ?? [];
  const reason = event.reason ?? 'review';
  const signature = event.signature ?? null;
  updateTask(state, event.taskId, event.at, {
    fixRounds: event.round,
    fixFor: event.reason ?? null,
    fixSignature: signature,
    stalledFixes: event.stalled ?? 0,
    fixHistory: event.round === 0 ? [] : signature ? [...history, `${reason}:${signature}`] : history,
    ...(task?.fixFingerprints || event.treeHash !== undefined
      ? { fixFingerprints: listFixFingerprints(task, event) }
      : {}),
  });
  if (event.round > 0 || event.reason === 'you') {
    record(state, event.taskId, event.at, {
      actor: 'shinsa',
      kind: 'fix',
      text: describeFixRound(event.round, reason),
    });
  }
}

const NEW_WORK_TEXT = {
  new_round: 'Asked for more work in this task',
  separate_task: 'Asked for work that belongs in another task',
} as const;

function applyMessaged(state: ShinsaState, event: EventOf<'task.messaged'>) {
  const scheduleId = event.scheduleId;
  if (event.kind === 'new_round' || event.kind === 'separate_task') {
    record(state, event.taskId, event.at, {
      actor: 'you',
      kind: 'round',
      text: NEW_WORK_TEXT[event.kind],
      detail: event.text,
    });
    return;
  }
  record(state, event.taskId, event.at, {
    actor: scheduleId ? 'shinsa' : 'you',
    kind: 'message',
    text: scheduleId ? `Sent instructions from ${describeSchedule(state, scheduleId)}` : 'Sent instructions',
    detail: event.text,
  });
}

function applyPlanApproved(state: ShinsaState, event: EventOf<'plan.approved'>) {
  const plan = state.tasks[event.taskId]?.plan;
  if (plan?.version !== event.version) return;
  updateTask(state, event.taskId, event.at, { plan: { ...plan, approvedAt: event.at } });
}

function applyNoted(state: ShinsaState, event: EventOf<'task.noted'>) {
  updateTask(state, event.taskId, event.at, { note: event.note });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'note',
    text: event.note,
    runId: event.runId ?? null,
  });
}

function applyWorkSubmitted(state: ShinsaState, event: EventOf<'work.submitted'>) {
  updateTask(state, event.taskId, event.at, { summary: event.summary, report: event.report ?? null });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'work',
    text: 'Handed over the work',
    detail: event.report?.headline ?? event.summary,
  });
}

function applyReviewReported(state: ShinsaState, event: EventOf<'review.reported'>) {
  updateTask(state, event.taskId, event.at, { findings: event.findings });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'review',
    runId: event.runId ?? null,
    text: describeFindings(event.findings),
  });
}

function applyChecksRecorded(state: ShinsaState, event: EventOf<'checks.recorded'>) {
  updateTask(state, event.taskId, event.at, { checkResults: event.results });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'review',
    text: describeChecks(event.results),
    detail: describeFailedChecks(event.results),
  });
}

function applyEvidenceAttached(state: ShinsaState, event: EventOf<'evidence.attached'>) {
  state.evidence[event.evidence.id] = event.evidence;
  record(state, event.evidence.taskId, event.at, {
    actor: 'agent',
    kind: 'evidence',
    text: `Attached ${event.evidence.title}`,
    evidenceId: event.evidence.id,
  });
}

type WorkspaceEvent = Extract<
  ShinsaEvent,
  {
    type:
      | 'repo.registered'
      | 'repo.updated'
      | 'repo.removed'
      | 'area.written'
      | 'project.written'
      | 'area.removed'
      | 'project.removed'
      | 'focus.changed'
      | 'settings.changed'
      | 'briefing.written';
  }
>;

function applyWorkspaceEvent(state: ShinsaState, event: WorkspaceEvent) {
  switch (event.type) {
    case 'repo.registered':
    case 'repo.updated':
      state.repos[event.repo.id] = readRepo(event.repo);
      return;
    case 'repo.removed':
      delete state.repos[event.repoId];
      return;
    case 'area.written':
      applyAreaWritten(state, event.area);
      return;
    case 'project.written':
      state.projects[event.project.id] = { ...event.project, folders: [...event.project.folders] };
      return;
    case 'area.removed':
      delete state.projects[event.areaId];
      return;
    case 'project.removed':
      delete state.projects[event.projectId];
      return;
    case 'focus.changed':
      state.focus = readFocus(event.focus);
      return;
    case 'settings.changed':
      applySettingsChanged(state, event);
      return;
    case 'briefing.written':
      state.briefings[briefingKey(event.projectId ?? event.areaId ?? null)] = {
        text: event.text,
        at: event.at,
        briefing: event.briefing ?? null,
      };
      return;
  }
}

function applyTaskCreated(state: ShinsaState, event: EventOf<'task.created'>) {
  state.tasks[event.taskId] = { ...createTask(event), ...resolveLineage(event) };
  if (event.handle) recordHandle(state, event.handle);
  recordCourierTask(state, event);
  applyScheduledTask(state, event);
}

export function applyEvent(state: ShinsaState, event: ShinsaEvent): ShinsaState {
  if (event.onBehalf) return applyOnBehalf(state, event.byTask ?? null, () => applyEventBody(state, event));
  return applyEventBody(state, event);
}

function applyEventBody(state: ShinsaState, event: ShinsaEvent): ShinsaState {
  state.seq = event.seq;
  switch (event.type) {
    case 'repo.registered':
    case 'repo.updated':
    case 'repo.removed':
    case 'area.written':
    case 'project.written':
    case 'area.removed':
    case 'project.removed':
    case 'focus.changed':
    case 'settings.changed':
    case 'briefing.written':
      applyWorkspaceEvent(state, event);
      break;
    case 'task.created':
      applyTaskCreated(state, event);
      break;
    case 'task.triaged':
      applyTriaged(state, event);
      break;
    case 'task.staged':
      applyStaged(state, event);
      break;
    case 'task.prioritized':
      applyPrioritized(state, event);
      break;
    case 'task.waits_on_changed':
      applyWaitsOnChanged(state, event);
      break;
    case 'task.noted':
      applyNoted(state, event);
      break;
    case 'task.messaged':
      applyMessaged(state, event);
      break;
    case 'task.recovered':
      updateTask(state, event.taskId, event.at, {
        recoveries: event.recoveries,
        ...(event.fingerprint === undefined ? {} : { recoveryFingerprint: event.fingerprint }),
      });
      break;
    case 'worktree.created':
      updateTask(state, event.taskId, event.at, { worktreePath: event.path, branch: event.branch });
      recordRoundBranch(state, event.taskId, event.branch, event.at);
      break;
    case 'worktree.removed':
      updateTask(state, event.taskId, event.at, { worktreePath: null });
      break;
    case 'plan.proposed':
      applyPlanProposed(state, event);
      break;
    case 'plan.answered':
      updateTask(state, event.taskId, event.at, { planAnswers: event.answers });
      break;
    case 'phase.updated':
      applyPhaseUpdated(state, event);
      break;
    case 'phase.completed':
      applyPhaseCompleted(state, event);
      break;
    case 'work.submitted':
      applyWorkSubmitted(state, event);
      break;
    case 'review.reported':
      applyReviewReported(state, event);
      break;
    case 'fix.started':
      applyFixStarted(state, event);
      break;
    case 'checks.recorded':
      applyChecksRecorded(state, event);
      break;
    case 'gate.opened':
    case 'gate.answered':
    case 'gate.withdrawn':
    case 'gate.noted':
    case 'gate.superseded':
      applyGateEvent(state, event);
      break;
    case 'evidence.attached':
      applyEvidenceAttached(state, event);
      break;
    case 'pull_request.opened':
    case 'pull_request.updated':
    case 'pull_request.push_requested':
    case 'pull_request.pushed':
    case 'pull_request.head_moved':
    case 'pull_request.watched':
    case 'pull_request.read_failed':
    case 'pull_request.read_failures_cleared':
      applyPullRequestEvent(state, event);
      break;
    case 'round.queued':
    case 'round.started':
    case 'round.shipping_changed':
    case 'round.pull_request_merged':
      applyRoundEvent(state, event);
      break;
    case 'task.answered':
    case 'task.reshaped':
    case 'task.delivered':
    case 'task.change_proposed':
    case 'task.change_declined':
    case 'task.change_approved':
      applyShapeEvent(state, event);
      break;
    case 'plan.approved':
      applyPlanApproved(state, event);
      break;
    case 'review.escalated':
      record(state, event.taskId, event.at, {
        actor: 'shinsa',
        kind: 'review',
        text: describeEscalation(event.escalation),
      });
      break;
    case 'work.committed':
      updateTask(state, event.taskId, event.at, { treeHash: event.treeHash });
      break;
    case 'task.suggested':
      applySuggested(state, event);
      break;
    case 'suggestion.settled':
      applySuggestionSettled(state, event);
      break;
    case 'config.verified':
      updateTask(state, event.taskId, event.at, { configProblems: event.problems });
      break;
    case 'budget.acknowledged':
      updateTask(state, event.taskId, event.at, {
        ...(event.spentUsd === undefined ? {} : { budgetAcknowledgedUsd: event.spentUsd }),
        ...(event.spentPercent === undefined ? {} : { usageAcknowledgedPercent: event.spentPercent }),
      });
      break;
    case 'task.account_bound':
      applyAccountBound(state, event);
      break;
    case 'on_behalf.acted':
      applyOnBehalfActed(state, event);
      break;
    case 'monitor.armed':
    case 'monitor.fired':
    case 'monitor.ended':
    case 'usage_wait.armed':
    case 'usage_wait.ended':
      applyWaitEvent(state, event);
      break;
    case 'run.started':
    case 'run.dispatched':
    case 'run.ended':
    case 'run.interrupted':
    case 'run.continued':
    case 'run.linked':
    case 'run.attempted':
    case 'run.session_lost':
    case 'run.metered':
    case 'run.silenced':
    case 'run.silence_snoozed':
    case 'run.silence_dismissed':
    case 'run.compacted':
      applyRunEvent(state, event);
      break;
    case 'delegation.asked':
    case 'delegation.answered':
    case 'delegation.acknowledged':
    case 'delegation.wake_changed':
    case 'delegation.adopted':
    case 'delegation.claimed':
    case 'delegation.delivered':
    case 'delegation.released':
    case 'delegation.message_queued':
    case 'run.waiting':
    case 'task.split':
      applyDelegationEvent(state, event);
      break;
    case 'schedule.written':
    case 'schedule.removed':
    case 'schedule.fired':
      applyScheduleEvent(state, event);
      break;
  }
  return state;
}

export interface ReplayFailure {
  seq: number;
  type: string;
  error: string;
}

export function replayEventLog(events: Iterable<ShinsaEvent>) {
  let state = createState();
  const failures: ReplayFailure[] = [];
  for (const event of events) {
    try {
      state = applyEvent(state, event);
    } catch (error) {
      state.seq = Math.max(state.seq, event.seq);
      failures.push({
        seq: event.seq,
        type: event.type,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { state, failures };
}
