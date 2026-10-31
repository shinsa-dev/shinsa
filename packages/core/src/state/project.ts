import type { StoredBriefing } from '../briefing/types.ts';
import {
  type BacklogCause,
  createSettings,
  type Evidence,
  type Focus,
  formatTaskHandle,
  type Gate,
  type MemoryEntry,
  NO_PROJECT_KEY,
  needsWorktree,
  type OnBehalfAction,
  type PhaseReport,
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
  type TaskStage,
  type WatchSuggestion,
} from '../domain/index.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import { resolveMergeStepKey } from '../report/merge-steps.ts';
import { resolvePlanChanges } from '../report/plan-changes.ts';
import { createTesting } from '../report/testing.ts';
import type { ReportCheck, ReportWalkthroughRevision } from '../report/types.ts';
import { applyAccountBound } from './accounts.ts';
import {
  describeCheckChange,
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
import { recordFork } from './forks.ts';
import { applyGateEvent } from './gates.ts';
import { applyInboxEvent } from './inbox.ts';
import { applyIterationEvent } from './iterations.ts';
import { applyMemoryEvent } from './memory.ts';
import { applyOnBehalfActed } from './on-behalf.ts';
import { applyOverlapEvent } from './overlaps.ts';
import { applyPullRequestEvent } from './pull-requests.ts';
import { applyRoundEvent, createFirstRound, recordRoundBranch, recordRoundStaged } from './rounds.ts';
import { applyRunEvent } from './runs.ts';
import { applyScheduledTask, applyScheduleEvent, describeSchedule } from './schedules.ts';
import { applyShapeEvent, describeShape } from './shapes.ts';
import { applySlackEvent } from './slack.ts';
import { applySuggested, applySuggestionSettled } from './suggestions.ts';
import { applyWaitEvent } from './waits.ts';
import { applyWatchSuggestionEvent } from './watch-suggestions.ts';
import { applyWatchdogEvent } from './watchdogs.ts';
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
  memories: Record<string, MemoryEntry>;
  watchSuggestions: Record<string, WatchSuggestion>;
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
    memories: {},
    watchSuggestions: {},
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
    ...(event.forkOf ? { forkOf: event.forkOf } : {}),
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

function resolveCancelledFrom(task: Task | undefined, stage: TaskStage) {
  if (stage !== 'cancelled') return task?.cancelledFrom ? { cancelledFrom: null } : {};
  if (!task || task.stage === 'cancelled') return {};
  return { cancelledFrom: task.stage };
}

function applyStaged(state: ShinsaState, event: EventOf<'task.staged'>) {
  const task = state.tasks[event.taskId];
  const previous = task?.stage;
  const stage = event.stage;
  updateTask(state, event.taskId, event.at, {
    stage,
    stageReason: event.reason,
    stageChangedAt: event.at,
    ...resolveCancelledFrom(task, stage),
    ...(stage === 'checking' ? {} : { runningChecks: [] }),
  });
  const answered = previous === 'answering' && (stage === 'done' || stage === 'merged');
  const duplicated = stage === 'cancelled' && Boolean(task?.duplicate);
  const text = answered || duplicated ? null : describeStage(stage, event.reason, Boolean(task?.pullRequest));
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

function applyDuplicated(state: ShinsaState, event: EventOf<'task.duplicated'>) {
  updateTask(state, event.taskId, event.at, { duplicate: { ...event.duplicate } });
  const original = state.tasks[event.duplicate.of];
  const handle = original?.handle ? `${original.handle} ` : '';
  record(state, event.taskId, event.at, {
    actor: event.duplicate.by,
    kind: 'stage',
    text: `Closed as a duplicate of ${handle}“${original?.title ?? 'another task'}”`,
  });
}

function applyDuplicateCleared(state: ShinsaState, event: EventOf<'task.duplicate_cleared'>) {
  updateTask(state, event.taskId, event.at, { duplicate: null, closedAt: null, cancelledFrom: null });
  record(state, event.taskId, event.at, { actor: 'you', kind: 'stage', text: 'Not a duplicate after all' });
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

const BACKLOG_LEFT: Record<BacklogCause, string> = {
  you: 'Removed from the backlog',
  started: 'Started building from the backlog',
  inquiry: 'Started at once: questions, research and investigations never wait in the backlog',
};

function applyBacklogChanged(state: ShinsaState, event: EventOf<'task.backlog_changed'>) {
  updateTask(state, event.taskId, event.at, { backlog: event.backlog ? { at: event.at } : null });
  record(state, event.taskId, event.at, {
    actor: event.cause === 'you' ? 'you' : 'shinsa',
    kind: 'stage',
    text: event.backlog ? 'Moved to the backlog' : BACKLOG_LEFT[event.cause],
  });
}

function applySnoozeChanged(state: ShinsaState, event: EventOf<'task.snooze_changed'>) {
  updateTask(state, event.taskId, event.at, { snoozed: event.snoozed ? { at: event.at } : null });
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'stage',
    text: event.snoozed ? 'Snoozed: it keeps its place, out of Needs you and Home' : 'Unsnoozed',
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
  const checks = (document?.verification ?? []).map((check, index) => ({
    id: `c${index + 1}`,
    ...check,
    phases: [...check.phases],
    source: 'plan' as const,
  }));
  updateTask(state, event.taskId, event.at, {
    plan: { version, body: event.body, document, proposedAt: event.at, ...revision },
    phases: (document?.phases ?? []).map(() => ({ status: 'pending' as const, at: event.at })),
    checks,
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

function selectLatestReport(reports: PhaseReport[]) {
  return reports.reduce<PhaseReport | null>(
    (latest, report) => (latest === null || report.index > latest.index ? report : latest),
    null
  );
}

function resolveRevisedReport(
  reports: PhaseReport[],
  revision: ReportWalkthroughRevision
): PhaseReport | null {
  const described = selectLatestReport(reports.filter((report) => report.walkthrough));
  if (described?.walkthrough) {
    return { ...described, walkthrough: { ...described.walkthrough, ...revision } };
  }
  const latest = selectLatestReport(reports);
  if (!latest || revision.approach === undefined || revision.flow === undefined) return null;
  return {
    ...latest,
    walkthrough: {
      approach: revision.approach,
      flow: revision.flow,
      risks: revision.risks ?? [],
      testing: revision.testing ?? createTesting(),
      ...(revision.steps ? { steps: revision.steps } : {}),
    },
  };
}

function applyWalkthroughRevised(state: ShinsaState, event: EventOf<'walkthrough.revised'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const revised = resolveRevisedReport(task.phaseReports, event.walkthrough);
  if (!revised) return;
  const phaseReports = task.phaseReports.map((report) => (report.index === revised.index ? revised : report));
  updateTask(state, event.taskId, event.at, { phaseReports });
}

function applyMergeStepTicked(state: ShinsaState, event: EventOf<'merge_step.ticked'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const carried = task.carriedMergeSteps ?? [];
  if (carried.some((step) => resolveMergeStepKey(step) === event.key)) {
    updateTask(state, event.taskId, event.at, {
      carriedMergeSteps: carried.map((step) =>
        resolveMergeStepKey(step) === event.key ? { ...step, done: event.done } : step
      ),
    });
  } else {
    const others = (task.mergeStepsDone ?? []).filter((key) => key !== event.key);
    updateTask(state, event.taskId, event.at, {
      mergeStepsDone: event.done ? [...others, event.key] : others,
    });
  }
  record(state, event.taskId, event.at, {
    actor: 'you',
    kind: 'decision',
    text: event.done ? `Ticked the step “${event.title}”` : `Unticked the step “${event.title}”`,
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
      ...(event.suggestionId ? { suggestionId: event.suggestionId } : {}),
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
  if (event.kept) keepMessage(state, event);
}

function keepMessage(state: ShinsaState, event: EventOf<'task.messaged'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  const sender = event.scheduleId ? 'schedule' : 'agent';
  updateTask(state, event.taskId, event.at, {
    untoldMessages: [...(task.untoldMessages ?? []), { at: event.at, text: event.text, sender }],
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
  updateTask(state, event.taskId, event.at, {
    reviewSummary: event.summary,
    findings: event.findings,
    reviewDisagreements: event.disagreements ?? [],
  });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'review',
    runId: event.runId ?? null,
    text: describeFindings(event.findings),
  });
}

function mergeCheckResults(task: Task, results: ReportCheck[]) {
  const ids = new Set(results.map((result) => result.id));
  const kept = (task.checkResults ?? []).filter((result) => !ids.has(result.id));
  return [...kept, ...structuredClone(results)];
}

function applyChecksRecorded(state: ShinsaState, event: EventOf<'checks.recorded'>) {
  const task = state.tasks[event.taskId];
  if (!task) return;
  updateTask(state, event.taskId, event.at, {
    checkResults: mergeCheckResults(task, event.results),
    runningChecks: [],
    ...(event.coverage ? { coverage: structuredClone(event.coverage) } : {}),
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'check',
    text: describeChecks(event.results),
    detail: describeFailedChecks(event.results),
  });
}

function applyChecksChanged(state: ShinsaState, event: EventOf<'checks.changed'>) {
  for (const change of event.changes) {
    const task = state.tasks[event.taskId];
    if (!task) return;
    const checks = task.checks ?? [];
    const id = change.check.id;
    const next =
      change.action === 'add'
        ? [...checks, structuredClone(change.check)]
        : checks.flatMap((check) => {
            if (check.id !== id) return [check];
            return change.action === 'remove' ? [] : [structuredClone(change.check)];
          });
    const results = (task.checkResults ?? []).filter((result) => result.id !== id);
    updateTask(state, event.taskId, event.at, {
      checks: next,
      ...(change.action === 'add' ? {} : { checkResults: results }),
    });
    record(state, event.taskId, event.at, {
      actor: 'agent',
      kind: 'check',
      text: describeCheckChange(change),
      detail: `${change.action === 'remove' ? '' : `\`${change.check.command}\`: `}${change.reason}`,
    });
  }
}

function hasEvidenceItem(state: ShinsaState, itemId: string | undefined) {
  return itemId !== undefined && Object.values(state.evidence).some((piece) => piece.itemId === itemId);
}

function updateEvidence(state: ShinsaState, id: string, patch: Partial<Evidence>) {
  const evidence = state.evidence[id];
  if (!evidence) return;
  writeEntry(state, 'evidence', id, { ...evidence, ...patch });
}

function applyEvidenceAttached(state: ShinsaState, event: EventOf<'evidence.attached'>) {
  const known = hasEvidenceItem(state, event.evidence.itemId);
  const replaces = event.replaces ?? [];
  writeEntry(state, 'evidence', event.evidence.id, event.evidence);
  for (const id of replaces) updateEvidence(state, id, { replacedBy: event.evidence.id });
  if (known) return;
  record(state, event.evidence.taskId, event.at, {
    actor: 'agent',
    kind: 'evidence',
    text: `${replaces.length > 0 ? 'Updated' : 'Attached'} ${event.evidence.title}`,
    evidenceId: event.evidence.id,
  });
}

function applyEvidenceRemoved(state: ShinsaState, event: EventOf<'evidence.removed'>) {
  const [first] = event.ids;
  const removed = first ? state.evidence[first] : undefined;
  for (const id of event.ids) {
    updateEvidence(state, id, { removedAt: event.at, removedReason: event.reason });
  }
  if (!removed) return;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'evidence',
    text: `Removed ${removed.title}`,
    detail: event.reason,
    evidenceId: removed.id,
    runId: event.runId,
  });
}

function applyEvidenceUploaded(state: ShinsaState, event: EventOf<'evidence.uploaded'>) {
  for (const upload of event.uploads) updateEvidence(state, upload.evidenceId, { uploadUrl: upload.url });
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
        ...(event.repo.coverage ? { coverage: { ...event.repo.coverage } } : {}),
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
  recordFork(state, event);
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
    case 'task.duplicated':
      applyDuplicated(state, event);
      break;
    case 'task.duplicate_cleared':
      applyDuplicateCleared(state, event);
      break;
    case 'task.waits_on_changed':
      applyWaitsOnChanged(state, event);
      break;
    case 'task.backlog_changed':
      applyBacklogChanged(state, event);
      break;
    case 'task.snooze_changed':
      applySnoozeChanged(state, event);
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
    case 'iteration.requested':
    case 'iteration.answered':
      applyIterationEvent(state, event);
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
    case 'walkthrough.revised':
      applyWalkthroughRevised(state, event);
      break;
    case 'merge_step.ticked':
      applyMergeStepTicked(state, event);
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
    case 'checks.changed':
      applyChecksChanged(state, event);
      break;
    case 'checks.started':
      updateTask(state, event.taskId, event.at, { runningChecks: [...event.checkIds] });
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
    case 'evidence.removed':
      applyEvidenceRemoved(state, event);
      break;
    case 'evidence.uploaded':
      applyEvidenceUploaded(state, event);
      break;
    case 'pull_request.opened':
    case 'pull_request.updated':
    case 'pull_request.push_requested':
    case 'pull_request.pushed':
    case 'pull_request.head_moved':
    case 'pull_request.watched':
    case 'pull_request.read_failed':
    case 'pull_request.read_failures_cleared':
    case 'pull_request.push_retrying':
    case 'pull_request.hook_failed':
    case 'pull_request.closed':
      applyPullRequestEvent(state, event);
      break;
    case 'round.queued':
    case 'round.started':
    case 'round.shipping_changed':
    case 'round.pull_request_merged':
    case 'round.updated':
    case 'round.removed':
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
    case 'task.messages_told':
      updateTask(state, event.taskId, event.at, { untoldMessages: [] });
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
    case 'run.cached':
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
    case 'schedule.read':
      applyScheduleEvent(state, event);
      break;
    case 'watchdog.armed':
    case 'watchdog.started':
    case 'watchdog.checking':
    case 'watchdog.deferred':
    case 'watchdog.live':
    case 'watchdog.missed':
    case 'watchdog.checked':
    case 'watchdog.report_linked':
    case 'watchdog.ended':
    case 'watch_source.written':
    case 'watch_source.removed':
      applyWatchdogEvent(state, event);
      break;
    case 'slack.thread_linked':
    case 'slack.status_posted':
      applySlackEvent(state, event);
      break;
    case 'memory.written':
    case 'memory.proposed':
    case 'memory.removed':
      applyMemoryEvent(state, event);
      break;
    case 'watch_suggestion.recorded':
    case 'watch_suggestion.accepted':
    case 'watch_suggestion.dismissed':
    case 'watch_suggestion.removed':
      applyWatchSuggestionEvent(state, event);
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
