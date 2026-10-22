import {
  applyEvent,
  createState,
  decide,
  listActiveRuns,
  listOpenGates,
  type PullRequest,
  type ReportCheck,
  type Run,
  type ShinsaCommand,
  type ShinsaEffect,
  type ShinsaState,
  type SpecDocument,
} from '../src/index.ts';

export type Harness = ReturnType<typeof createHarness>;

export function createHarness() {
  let state = createState();
  let clock = 1_000;
  let counter = 0;
  const effects: ShinsaEffect[] = [];

  function send(command: ShinsaCommand) {
    clock += 1;
    const decision = decide(state, command, { now: clock, newId: () => `id${++counter}` });
    for (const event of decision.events) {
      state = applyEvent(state, { ...event, seq: state.seq + 1, at: clock });
    }
    effects.push(...decision.effects);
    return decision;
  }

  function effectsOf<K extends ShinsaEffect['kind']>(kind: K) {
    return effects.filter((effect) => effect.kind === kind) as Extract<ShinsaEffect, { kind: K }>[];
  }

  function lastEffect<K extends ShinsaEffect['kind']>(kind: K) {
    const found = effectsOf(kind).at(-1);
    if (!found) throw new Error(`no ${kind} effect`);
    return found;
  }

  function activeRun(taskId: string): Run {
    const run = listActiveRuns(state, taskId)[0];
    if (!run) throw new Error(`task ${taskId} has no active run (stage ${state.tasks[taskId]?.stage})`);
    return run;
  }

  function openGate(taskId: string) {
    const gate = listOpenGates(state, taskId)[0];
    if (!gate) throw new Error(`task ${taskId} has no open gate (stage ${state.tasks[taskId]?.stage})`);
    return gate;
  }

  return {
    send,
    effects,
    effectsOf,
    lastEffect,
    activeRun,
    openGate,
    task: (taskId: string) => {
      const task = state.tasks[taskId];
      if (!task) throw new Error(`no task ${taskId}`);
      return task;
    },
    get state(): ShinsaState {
      return state;
    },
  };
}

export function registerRepo(harness: Harness, name = 'paywall-next', areaName: string | null = 'Superwall') {
  harness.send({
    type: 'repo.register',
    repo: {
      name,
      path: `/code/${name}`,
      defaultBranch: 'main',
      remote: `github.com/superwall/${name}`,
      checkCommands: ['bun lint', 'bun check-types'],
      previewCommand: null,
    },
    areaName,
  });
  return Object.values(harness.state.repos).find((repo) => repo.name === name)?.id ?? '';
}

export const SPEC: SpecDocument = {
  goal: 'Ship it.',
  plan: [
    { title: 'Find the overflow', detail: 'Trace which container scrolls.' },
    { title: 'Fix and verify', detail: 'Clamp the width and check it in the browser.' },
  ],
  behaviour: ['It works.'],
  approach: 'Carefully.',
  files: [],
  outOfScope: [],
  verification: [],
  questions: [],
};

export const PASSING: ReportCheck[] = [
  { name: 'bun lint', outcome: 'pass', detail: null },
  { name: 'bun check-types', outcome: 'pass', detail: null },
];

export function failing(name = 'bun check-types', detail = 'src/a.ts(3,1): error TS2322'): ReportCheck[] {
  return [
    { name: 'bun lint', outcome: 'pass', detail: null },
    { name, outcome: 'fail', detail },
  ];
}

export function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    url: 'https://github.com/superwall/paywall-next/pull/42',
    state: 'open',
    checks: 'passing',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: 0,
    ...overrides,
  };
}

export function createTask(
  harness: Harness,
  options: {
    intent?: string;
    size?: 'small' | 'large';
    repoId?: string;
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    dependsOn?: string | string[];
    blockedBy?: string[];
  } = {}
) {
  const repoId = options.repoId ?? (Object.keys(harness.state.repos)[0] || registerRepo(harness));
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({
    type: 'task.create',
    intent: options.intent ?? 'Fix the scroll in tab groups',
    repoId,
    priority: options.priority,
    blockedBy: options.blockedBy,
  });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: options.intent ?? 'Fix tab group scroll',
    repoId,
    size: options.size ?? 'small',
    branch: `fix/${taskId}`,
    dependsOn: [options.dependsOn ?? []].flat(),
  });
  readyWorktree(harness, taskId);
  return taskId;
}

export function readyWorktree(harness: Harness, taskId: string) {
  if (harness.task(taskId).stage !== 'triage') return;
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/${taskId}` });
}

export function approve(harness: Harness, taskId: string, response: string | null = null) {
  harness.send({ type: 'gate.answer', gateId: harness.openGate(taskId).id, decision: 'approve', response });
}

export function pushed(harness: Harness, taskId: string, sha = `sha-${harness.state.seq}`) {
  harness.send({ type: 'pull_request.pushed', taskId, sha });
}

export function reachShipping(harness: Harness, taskId: string) {
  reachReviewGate(harness, taskId);
  approve(harness, taskId);
  pushed(harness, taskId);
}

export function pushFix(harness: Harness, taskId: string, summary = 'Fixed it.') {
  harness.send({ type: 'agent.complete_fix', runId: harness.activeRun(taskId).id, summary });
  pushed(harness, taskId);
}

export function shipAndMerge(harness: Harness, taskId: string) {
  reachShipping(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
}

export function proposePlan(harness: Harness, taskId: string, spec: SpecDocument = SPEC) {
  harness.send({ type: 'agent.propose_plan', runId: harness.activeRun(taskId).id, document: spec });
}

export function completePhase(harness: Harness, taskId: string, summary = 'Did the phase.') {
  harness.send({
    type: 'agent.complete_phase',
    runId: harness.activeRun(taskId).id,
    summary,
    spots: [{ file: 'src/a.ts', start: 1, end: 3, attention: 'critical', why: 'The change.' }],
    decisions: [],
  });
}

export function buildAll(harness: Harness, taskId: string) {
  proposePlan(harness, taskId);
  const phases = harness.task(taskId).spec?.document?.plan.length ?? 1;
  for (let index = 0; index < phases; index += 1) completePhase(harness, taskId, `Phase ${index + 1} done.`);
}

export function reachReviewGate(harness: Harness, taskId: string) {
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({ type: 'agent.report_review', runId: harness.activeRun(taskId).id, findings: [] });
}

export function linkSession(harness: Harness, taskId: string, sessionId = 'session-1') {
  harness.send({ type: 'run.link', runId: harness.activeRun(taskId).id, sessionId });
}
