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
  resolveShapeOf,
  resolveTaskPipeline,
  type Schedule,
  type Settings,
  SHAPE_PIPELINES,
  type Task,
  type TaskShape,
} from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
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
import { removeEntry, writeEntry } from './draft.ts';
import { applyGateEvent } from './gates.ts';
import { applyInboxEvent } from './inbox.ts';
import { applyOnBehalfActed } from './on-behalf.ts';
import { applyOverlapEvent } from './overlaps.ts';
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

export function replaceBriefing(state: ShinsaState, projectId: string | null, stored: StoredBriefing) {
  return { ...state, briefings: { ...state.briefings, [briefingKey(projectId)]: stored } };
}

function recordHandle(state: ShinsaState, handle: string) {
  const parsed = parseTaskHandle(handle);
  if (!parsed) return;
  const [key = NO_PROJECT_KEY, number = '0'] = parsed.split('-');
  writeEntry(state, 'taskNumbers', key, Math.max(state.taskNumbers[key] ?? 0, Number(number)));
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
  const request = event.request;
  const title = request.split('\n', 1)[0]?.slice(0, UNTITLED_LENGTH) ?? '';
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
    request,
    title,
    repoId: event.repoId,
    size: null,
    planFirst: event.planFirst,
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
    reviewSummary: null,
    findings: [],
    fixRounds: 0,
    fixFor: null,
    fixSignature: null,
    stalledFixes: 0,
    recoveries: 0,
    phaseReports: [],
    checkResults: null,
    pullRequest: null,
    waitsOn: [],
    note: null,
    origin: event.origin,
    createdAt: event.at,
    updatedAt: event.at,
    stageChangedAt: event.at,
    activity: [
      {
        at: event.at,
        actor: 'you',
        kind: 'asked',
        text: resolveCreatedShape(event) === 'answer' ? 'Asked a question' : 'Asked for this',
        detail: request,
        evidenceId: null,
        ...(event.onBehalf ? { onBehalf: true } : {}),
        ...(event.byTask ? { byTask: event.byTask } : {}),
      },
    ],
    ...(event.mode === 'ask' ? { mode: 'ask' as const } : {}),
    ...(event.shape ? { pipeline: [...SHAPE_PIPELINES[event.shape]] } : {}),
    auto: { ...event.auto },
    ...(event.account ? { account: event.account } : {}),
    rounds: [createFirstRound(title, request, pipeline, event.at)],
  };
}

function describeSetUp(state: ShinsaState, event: EventOf<'task.triaged'>, shape: TaskShape) {
  if (shape === 'change') return `Set up as a ${event.size} change on ${event.branch}`;
  if (event.repoId === null)
    return shape === 'answer' ? 'Set up as a question' : `Set up as ${describeShape(shape)}`;
  const repo = state.repos[event.repoId]?.name ?? 'the repository';
  if (shape === 'answer') return `Set up as a question about ${repo}`;
  return `Set up as ${describeShape(shape)} in ${repo}`;
}

function applyTriaged(state: ShinsaState, event: EventOf<'task.triaged'>) {
  const task = state.tasks[event.taskId];
  const pipeline = event.pipeline ?? (task ? [...resolveTaskPipeline(task)] : []);
  const worktree = needsWorktree(pipeline);
  const projectId = task?.projectId ?? event.projectId ?? null;
  const handle = task?.handle ?? event.handle ?? null;
  if (task && !task.handle && handle) recordHandle(state, handle);
  updateTask(state, event.taskId, event.at, {
    title: event.title,
    repoId: event.repoId,
    projectId,
    handle,
    size: event.size,
    branch: worktree ? event.branch : null,
    ...(event.pipeline ? { pipeline: event.pipeline } : {}),
    ...(worktree ? {} : { proposedBranch: event.branch }),
    triageDecisions: event.decisions,
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

function applyRepoBound(state: ShinsaState, event: EventOf<'task.repo_bound'>) {
  updateTask(state, event.taskId, event.at, {
    repoId: event.repoId,
    ...(event.projectId ? { projectId: event.projectId } : {}),
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'set_up',
    text: `Chose the repository ${state.repos[event.repoId]?.name ?? ''}`.trim(),
  });
}

function applyStaged(state: ShinsaState, event: EventOf<'task.staged'>) {
  const previous = state.tasks[event.taskId]?.stage;
  const stage = event.stage;
  updateTask(state, event.taskId, event.at, {
    stage,
    stageReason: event.reason,
    stageChangedAt: event.at,
  });
  const answered = previous === 'answering' && (stage === 'done' || stage === 'merged');
  const text = answered ? null : describeStage(stage);
  if (text && previous !== stage) {
    record(state, event.taskId, event.at, { actor: event.by ?? 'shinsa', kind: 'stage', text });
  }
  recordRoundStaged(state, event.taskId, stage, event.by, event.at);
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
  const waitsOn = event.waitsOn;
  updateTask(state, event.taskId, event.at, { waitsOn });
  const titles = waitsOn.map((id) => state.tasks[id]?.title ?? 'another task');
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
  const document = event.document;
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
    phases: (document?.phases ?? []).map(() => ({ status: 'pending' as const, at: event.at })),
    ...(previous === null ? {} : { planHistory: listPlanHistory(task) }),
  });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'plan',
    text: version === 1 ? 'Proposed a plan' : `Revised the plan (version ${version})`,
    detail: (version > 1 ? event.changeSummary : null) ?? document?.goal ?? null,
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
  const report = event.report;
  const phaseReports = [...task.phaseReports.filter((entry) => entry.index !== report.index), report];
  updateTask(state, event.taskId, event.at, { phaseReports });
  const title = task.plan?.document?.phases[report.index]?.title ?? `phase ${report.index + 1}`;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'work',
    text: `Finished: ${title}`,
    detail: report.summary,
    runId: report.runId ?? null,
  });
}

function listFixFingerprints(task: Task | undefined, event: EventOf<'fix.started'>) {
  if (event.round === 0) return [];
  return [
    ...(task?.fixFingerprints ?? []),
    {
      reason: event.reason ?? 'review',
      signature: event.signature ?? null,
      treeHash: event.treeHash ?? null,
    },
  ];
}

function applyFixStarted(state: ShinsaState, event: EventOf<'fix.started'>) {
  const task = state.tasks[event.taskId];
  const signature = event.signature ?? null;
  const fixing = event.round > 0 || event.reason === 'you';
  updateTask(state, event.taskId, event.at, {
    fixRounds: event.round,
    fixFor: event.reason ?? null,
    fixSignature: signature,
    stalledFixes: event.stalled ?? 0,
    fixFingerprints: listFixFingerprints(task, event),
    ...(fixing && task?.approvedEdits ? { approvedEdits: null } : {}),
    ...(fixing && event.reason === 'conflict' && task?.heldConflict ? { heldConflict: null } : {}),
  });
  if (fixing) {
    record(state, event.taskId, event.at, {
      actor: 'shinsa',
      kind: 'fix',
      text: describeFixRound(event.round, event.reason ?? 'review'),
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
    text: scheduleId
      ? `Sent instructions from ${describeSchedule(state, scheduleId)}`
      : describeMessage(event),
    detail: event.text,
    ...(event.kind === 'acknowledge' ? { noted: true } : {}),
  });
}

function applyEdited(state: ShinsaState, event: EventOf<'task.edited'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const without = (paths: string[] | undefined) => (paths ?? []).filter((path) => path !== event.path);
  if (!event.changed) {
    updateTask(state, event.taskId, event.at, {
      editedPaths: without(task.editedPaths),
      untoldEdits: without(task.untoldEdits),
    });
    return;
  }
  const fresh = !(task.editedPaths ?? []).includes(event.path);
  updateTask(state, event.taskId, event.at, {
    editedPaths: [...without(task.editedPaths), event.path].sort(),
    untoldEdits: [...without(task.untoldEdits), event.path].sort(),
  });
  if (fresh)
    record(state, event.taskId, event.at, { actor: 'you', kind: 'work', text: `Edited ${event.path}` });
}

function describeMessage(event: EventOf<'task.messaged'>) {
  return event.kind === 'acknowledge' ? 'Sent a message' : 'Sent instructions';
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
  const report = event.report;
  updateTask(state, event.taskId, event.at, { summary: event.summary, report });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'work',
    text: 'Handed over the work',
    detail: report?.headline ?? event.summary,
  });
}

function applyReviewReported(state: ShinsaState, event: EventOf<'review.reported'>) {
  updateTask(state, event.taskId, event.at, { reviewSummary: event.summary, findings: event.findings });
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
  writeEntry(state, 'evidence', event.evidence.id, event.evidence);
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
      | 'project.written'
      | 'project.removed'
      | 'focus.changed'
      | 'settings.changed';
  }
>;

function applyWorkspaceEvent(state: ShinsaState, event: WorkspaceEvent) {
  switch (event.type) {
    case 'repo.registered':
    case 'repo.updated':
      writeEntry(state, 'repos', event.repo.id, {
        ...event.repo,
        checkCommands: [...event.repo.checkCommands],
      });
      return;
    case 'repo.removed':
      removeEntry(state, 'repos', event.repoId);
      return;
    case 'project.written':
      writeEntry(state, 'projects', event.project.id, {
        ...event.project,
        folders: [...event.project.folders],
      });
      return;
    case 'project.removed':
      removeEntry(state, 'projects', event.projectId);
      return;
    case 'focus.changed':
      state.focus = { ...event.focus };
      return;
    case 'settings.changed':
      state.settings = structuredClone(event.settings);
      return;
  }
}

function applyTaskCreated(state: ShinsaState, event: EventOf<'task.created'>) {
  writeEntry(state, 'tasks', event.taskId, { ...createTask(event), ...resolveLineage(event) });
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
    case 'project.written':
    case 'project.removed':
    case 'focus.changed':
    case 'settings.changed':
      applyWorkspaceEvent(state, event);
      break;
    case 'task.created':
      applyTaskCreated(state, event);
      break;
    case 'task.triaged':
      applyTriaged(state, event);
      break;
    case 'task.repo_bound':
      applyRepoBound(state, event);
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
    case 'task.message_received':
    case 'task.message_routed':
    case 'task.message_dropped':
      applyInboxEvent(state, event);
      break;
    case 'task.recovered':
      updateTask(state, event.taskId, event.at, {
        recoveries: event.recoveries,
        ...(event.fingerprint === undefined ? {} : { recoveryFingerprint: event.fingerprint }),
      });
      break;
    case 'worktree.requested':
      updateTask(state, event.taskId, event.at, { workspace: event.workspace });
      break;
    case 'worktree.created':
      updateTask(state, event.taskId, event.at, {
        worktreePath: event.path,
        branch: event.branch,
        workspace: event.workspace,
        ...(event.returnBranch === undefined ? {} : { returnBranch: event.returnBranch }),
      });
      recordRoundBranch(state, event.taskId, event.branch, event.at);
      break;
    case 'worktree.removed':
      updateTask(state, event.taskId, event.at, { worktreePath: null });
      break;
    case 'task.stacked':
      updateTask(state, event.taskId, event.at, {
        stackedOn: { taskId: event.onTaskId, branch: event.branch },
      });
      break;
    case 'task.unstacked':
      updateTask(state, event.taskId, event.at, { stackedOn: undefined });
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
      updateTask(state, event.taskId, event.at, { treeHash: event.treeHash, editedPaths: [] });
      break;
    case 'task.edited':
      applyEdited(state, event);
      break;
    case 'task.edits_told':
      updateTask(state, event.taskId, event.at, { untoldEdits: [] });
      break;
    case 'task.overlapped':
    case 'task.overlaps_told':
      applyOverlapEvent(state, event);
      break;
    case 'task.edits_committed':
      updateTask(state, event.taskId, event.at, { editedPaths: [] });
      break;
    case 'task.edits_approved':
      updateTask(state, event.taskId, event.at, { approvedEdits: event.gate });
      break;
    case 'task.conflict_held':
      updateTask(state, event.taskId, event.at, { heldConflict: event.branch });
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

export function replayEventLog(events: Iterable<ShinsaEvent>, from: ShinsaState = createState()) {
  let state = from;
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
