import type { StoredBriefing } from '../briefing/types.ts';
import type { EventOf, ShinsaEvent } from '../events/index.ts';
import {
  type Activity,
  type Area,
  createSettings,
  type Evidence,
  type Focus,
  type Gate,
  type Repo,
  type Run,
  type Settings,
  type Task,
} from '../model/index.ts';
import {
  describeChecks,
  describeDecision,
  describeDependencies,
  describeFailedChecks,
  describeFindings,
  describeFixRound,
  describeStage,
} from './activity.ts';

export interface ShinsaState {
  seq: number;
  repos: Record<string, Repo>;
  areas: Record<string, Area>;
  focus: Focus;
  settings: Settings;
  tasks: Record<string, Task>;
  runs: Record<string, Run>;
  gates: Record<string, Gate>;
  evidence: Record<string, Evidence>;
  briefings: Record<string, StoredBriefing>;
}

type ActivityEntry = Pick<Activity, 'actor' | 'kind' | 'text'> &
  Partial<Pick<Activity, 'detail' | 'evidenceId' | 'runId'>>;

const ACTIVITY_LIMIT = 200;

const UNTITLED_LENGTH = 80;

export function createState(): ShinsaState {
  return {
    seq: 0,
    repos: {},
    areas: {},
    focus: { areaId: null, until: null },
    settings: createSettings(),
    tasks: {},
    runs: {},
    gates: {},
    evidence: {},
    briefings: {},
  };
}

export function briefingKey(areaId: string | null) {
  return areaId ?? '*';
}

function record(state: ShinsaState, taskId: string, at: number, entry: ActivityEntry) {
  const task = state.tasks[taskId];
  if (!task) return;
  const activity = [...task.activity, { detail: null, evidenceId: null, ...entry, at }];
  state.tasks[taskId] = { ...task, activity: activity.slice(-ACTIVITY_LIMIT) };
}

function updateTask(state: ShinsaState, taskId: string, at: number, patch: Partial<Task>) {
  const task = state.tasks[taskId];
  if (!task) return;
  state.tasks[taskId] = { ...task, ...patch, updatedAt: at };
}

function updateRun(state: ShinsaState, runId: string, patch: Partial<Run>) {
  const run = state.runs[runId];
  if (!run) return;
  state.runs[runId] = { ...run, ...patch };
}

function updateGate(state: ShinsaState, gateId: string, patch: Partial<Gate>) {
  const gate = state.gates[gateId];
  if (!gate) return;
  state.gates[gateId] = { ...gate, ...patch };
}

function createTask(event: EventOf<'task.created'>): Task {
  return {
    id: event.taskId,
    intent: event.intent,
    title: event.intent.split('\n', 1)[0]?.slice(0, UNTITLED_LENGTH) ?? '',
    repoId: event.repoId,
    size: null,
    specFirst: event.specFirst ?? false,
    stage: 'triage',
    stageReason: 'sizing up the work',
    priority: event.priority,
    branch: null,
    worktreePath: null,
    spec: null,
    phases: [],
    specAnswers: null,
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
    blockedBy: [],
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
        text: 'Asked for this',
        detail: event.intent,
        evidenceId: null,
      },
    ],
  };
}

function applyTriaged(state: ShinsaState, event: EventOf<'task.triaged'>) {
  const baseTaskId = event.baseTaskId ?? null;
  const blockedBy = state.tasks[event.taskId]?.blockedBy ?? [];
  updateTask(state, event.taskId, event.at, {
    title: event.title,
    repoId: event.repoId,
    size: event.size,
    branch: event.branch,
    baseTaskId,
    blockedBy: baseTaskId && !blockedBy.includes(baseTaskId) ? [...blockedBy, baseTaskId] : blockedBy,
  });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'set_up',
    text: `Set up as a ${event.size} change on ${event.branch}`,
  });
}

function applyStaged(state: ShinsaState, event: EventOf<'task.staged'>) {
  const previous = state.tasks[event.taskId]?.stage;
  updateTask(state, event.taskId, event.at, {
    stage: event.stage,
    stageReason: event.reason,
    stageChangedAt: event.at,
  });
  const text = describeStage(event.stage);
  if (text && previous !== event.stage) {
    record(state, event.taskId, event.at, { actor: 'shinsa', kind: 'stage', text });
  }
}

function applyBlocked(state: ShinsaState, event: EventOf<'task.blocked'>) {
  updateTask(state, event.taskId, event.at, { blockedBy: event.blockedBy });
  const titles = event.blockedBy.map((id) => state.tasks[id]?.title ?? 'another task');
  record(state, event.taskId, event.at, {
    actor: event.by ?? 'you',
    kind: 'stage',
    text: describeDependencies(titles),
  });
}

function applySpecProposed(state: ShinsaState, event: EventOf<'spec.proposed'>) {
  const version = (state.tasks[event.taskId]?.spec?.version ?? 0) + 1;
  updateTask(state, event.taskId, event.at, {
    spec: { version, body: event.body, document: event.document ?? null, proposedAt: event.at },
    phases: (event.document?.plan ?? []).map(() => ({ status: 'pending' as const, at: event.at })),
  });
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'spec',
    text: version === 1 ? 'Proposed a plan' : `Revised the plan (version ${version})`,
    detail: event.document?.goal ?? null,
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
  const title = task.spec?.document?.plan[event.report.index]?.title ?? `phase ${event.report.index + 1}`;
  record(state, event.taskId, event.at, {
    actor: 'agent',
    kind: 'work',
    text: `Finished: ${title}`,
    detail: event.report.summary,
    runId: event.report.runId ?? null,
  });
}

function applyFixStarted(state: ShinsaState, event: EventOf<'fix.started'>) {
  const history = state.tasks[event.taskId]?.fixHistory ?? [];
  const reason = event.reason ?? 'review';
  const signature = event.signature ?? null;
  updateTask(state, event.taskId, event.at, {
    fixRounds: event.round,
    fixFor: event.reason ?? null,
    fixSignature: signature,
    stalledFixes: event.stalled ?? 0,
    fixHistory: event.round === 0 ? [] : signature ? [...history, `${reason}:${signature}`] : history,
  });
  if (event.round > 0 || event.reason === 'you') {
    record(state, event.taskId, event.at, {
      actor: 'shinsa',
      kind: 'fix',
      text: describeFixRound(event.round, reason),
    });
  }
}

function applyGateOpened(state: ShinsaState, event: EventOf<'gate.opened'>) {
  state.gates[event.gate.id] = event.gate;
  if (event.gate.purpose === 'decision') return;
  const failure = event.gate.purpose === 'failure';
  record(state, event.gate.taskId, event.at, {
    actor: failure ? 'shinsa' : 'agent',
    kind: failure ? 'failure' : 'question',
    text: event.gate.title,
    runId: event.gate.runId,
  });
}

function applyGateAnswered(state: ShinsaState, event: EventOf<'gate.answered'>) {
  updateGate(state, event.gateId, {
    status: 'answered',
    decision: event.decision,
    response: event.response,
    answeredAt: event.at,
  });
  const gate = state.gates[event.gateId];
  if (!gate) return;
  record(state, gate.taskId, event.at, {
    actor: 'you',
    kind: 'decision',
    text: describeDecision(event.decision, gate.title),
    detail: event.response,
  });
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

function applyPullRequestOpened(state: ShinsaState, event: EventOf<'pull_request.opened'>) {
  updateTask(state, event.taskId, event.at, { pullRequest: event.pullRequest });
  record(state, event.taskId, event.at, {
    actor: 'shinsa',
    kind: 'pull_request',
    text: `Opened pull request #${event.pullRequest.number}`,
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

export function applyEvent(state: ShinsaState, event: ShinsaEvent): ShinsaState {
  state.seq = event.seq;
  switch (event.type) {
    case 'repo.registered':
    case 'repo.updated':
      state.repos[event.repo.id] = event.repo;
      break;
    case 'repo.removed':
      delete state.repos[event.repoId];
      break;
    case 'area.written':
      state.areas[event.area.id] = event.area;
      break;
    case 'area.removed':
      delete state.areas[event.areaId];
      break;
    case 'focus.changed':
      state.focus = event.focus;
      break;
    case 'settings.changed':
      state.settings = event.settings;
      break;
    case 'task.created':
      state.tasks[event.taskId] = createTask(event);
      break;
    case 'task.triaged':
      applyTriaged(state, event);
      break;
    case 'task.staged':
      applyStaged(state, event);
      break;
    case 'task.prioritized':
      updateTask(state, event.taskId, event.at, { priority: event.priority });
      break;
    case 'task.blocked':
      applyBlocked(state, event);
      break;
    case 'task.noted':
      applyNoted(state, event);
      break;
    case 'task.messaged':
      record(state, event.taskId, event.at, {
        actor: 'you',
        kind: 'message',
        text: 'Sent instructions',
        detail: event.text,
      });
      break;
    case 'task.recovered':
      updateTask(state, event.taskId, event.at, { recoveries: event.recoveries });
      break;
    case 'worktree.created':
      updateTask(state, event.taskId, event.at, { worktreePath: event.path, branch: event.branch });
      break;
    case 'worktree.removed':
      updateTask(state, event.taskId, event.at, { worktreePath: null });
      break;
    case 'spec.proposed':
      applySpecProposed(state, event);
      break;
    case 'spec.answered':
      updateTask(state, event.taskId, event.at, { specAnswers: event.answers });
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
      applyGateOpened(state, event);
      break;
    case 'gate.answered':
      applyGateAnswered(state, event);
      break;
    case 'gate.withdrawn':
      updateGate(state, event.gateId, { status: 'withdrawn', answeredAt: event.at });
      break;
    case 'run.started':
      state.runs[event.run.id] = event.run;
      break;
    case 'run.dispatched':
      updateRun(state, event.runId, { status: 'running' });
      break;
    case 'run.linked':
      updateRun(state, event.runId, { sessionId: event.sessionId });
      break;
    case 'run.ended':
      updateRun(state, event.runId, { endedAt: event.at, outcome: event.outcome, summary: event.summary });
      break;
    case 'evidence.attached':
      applyEvidenceAttached(state, event);
      break;
    case 'pull_request.opened':
      applyPullRequestOpened(state, event);
      break;
    case 'pull_request.updated':
      updateTask(state, event.taskId, event.at, { pullRequest: event.pullRequest });
      break;
    case 'pull_request.push_requested':
      updateTask(state, event.taskId, event.at, { pushPending: true });
      break;
    case 'pull_request.pushed':
      updateTask(state, event.taskId, event.at, { pushedSha: event.sha, pushPending: false });
      break;
    case 'briefing.written':
      state.briefings[briefingKey(event.areaId)] = {
        text: event.text,
        at: event.at,
        briefing: event.briefing ?? null,
      };
      break;
  }
  return state;
}

export function replayEvents(events: Iterable<ShinsaEvent>) {
  let state = createState();
  for (const event of events) state = applyEvent(state, event);
  return state;
}
