import {
  type AgentReply,
  applyEvent,
  type ConfigProblem,
  createState,
  decide,
  type GuestActor,
  listActiveRuns,
  listOpenGates,
  type PlanDocument,
  type PullRequest,
  type ReportCheck,
  type Run,
  resolveTaskPipeline,
  type ShinsaCommand,
  type ShinsaEffect,
  type ShinsaEvent,
  type ShinsaEventInput,
  type ShinsaState,
  selectOpenIteration,
  splitHouseRules,
} from '../src/index.ts';

export type Harness = ReturnType<typeof createHarness>;

export function readInstruction(run: Run) {
  const prompt = run.rolePrompt ?? run.prompt ?? '';
  return splitHouseRules(prompt)?.instruction ?? prompt;
}

export function createHarness() {
  let state = createState();
  let clock = 1_000;
  let counter = 0;
  const effects: ShinsaEffect[] = [];
  const events: ShinsaEvent[] = [];

  function send(
    command: ShinsaCommand,
    options: { onBehalf?: boolean; byTask?: string | null; guest?: GuestActor | null } = {}
  ) {
    clock += 1;
    const decision = decide(state, command, { now: clock, newId: () => `id${++counter}`, ...options });
    for (const event of decision.events) {
      const applied = { ...event, seq: state.seq + 1, at: clock } as ShinsaEvent;
      events.push(applied);
      state = applyEvent(state, applied);
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

  function replay(event: ShinsaEventInput) {
    clock += 1;
    const applied = { ...event, seq: state.seq + 1, at: clock } as ShinsaEvent;
    events.push(applied);
    state = applyEvent(state, applied);
  }

  return {
    send,
    replay,
    advance: (ms: number) => {
      clock += ms;
    },
    effects,
    events,
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
    get now() {
      return clock;
    },
  };
}

export function registerRepo(
  harness: Harness,
  name = 'paywall-next',
  projectName: string | null = 'Superwall',
  checkCommands = ['bun lint', 'bun check-types']
) {
  harness.send({
    type: 'repo.register',
    repo: {
      name,
      path: `/code/${name}`,
      defaultBranch: 'main',
      remote: `github.com/superwall/${name}`,
      checkCommands,
    },
    projectName,
  });
  return Object.values(harness.state.repos).find((repo) => repo.name === name)?.id ?? '';
}

export const REPLY: AgentReply = {
  headline: 'Made the change you asked for.',
  points: [{ ask: 'The change', outcome: 'done', note: 'It is in.' }],
  next: null,
};

export function resolveOwedReply(state: ShinsaState, runId: string) {
  const run = state.runs[runId];
  const task = run ? state.tasks[run.taskId] : undefined;
  return task && selectOpenIteration(task) ? { reply: REPLY } : {};
}

export function resolveReply(harness: Harness, runId: string) {
  return resolveOwedReply(harness.state, runId);
}

export const PLAN: PlanDocument = {
  goal: 'Ship it.',
  phases: [
    { title: 'Find the overflow', detail: 'Trace which container scrolls.' },
    { title: 'Fix and verify', detail: 'Clamp the width and check it in the browser.' },
  ],
  behaviour: ['It works.'],
  approach: 'Carefully.',
  files: [],
  outOfScope: [],
  verification: [{ label: 'Panel tests', command: 'bun test src/panel', phases: [2] }],
  questions: [],
};

export const LARGE_PLAN: PlanDocument = {
  ...PLAN,
  phases: [
    ...PLAN.phases,
    { title: 'Cover the edge cases', detail: 'Test narrow and wide panels.' },
    { title: 'Write the docs', detail: 'Describe the clamp.' },
  ],
};

export const IMPACT =
  'Touches the 1,240 accounts without a plan; the dry run lists them. Undo by clearing the column.';

const CHECK_COMMANDS: Record<string, string> = {
  c1: 'bun test src/panel',
  r1: 'bun lint',
  r2: 'bun check-types',
};

export function checkResult(id: string, outcome: ReportCheck['outcome'], detail: string | null = null) {
  const command = CHECK_COMMANDS[id] ?? id;
  return { id, label: id === 'c1' ? 'Panel tests' : command, command, outcome, detail };
}

export const PASSING: ReportCheck[] = [
  checkResult('c1', 'pass'),
  checkResult('r1', 'pass'),
  checkResult('r2', 'pass'),
];

export function failing(id = 'r2', detail = 'src/a.ts(3,1): error TS2322'): ReportCheck[] {
  return [checkResult('r1', 'pass'), checkResult(id, 'fail', detail)];
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
    request?: string;
    size?: 'small' | 'large';
    repoId?: string;
    priority?: 'urgent' | 'high' | 'normal' | 'low';
    waitsOn?: string[];
    stacksOn?: string;
    triageWaitsOn?: string | string[];
    planFirst?: boolean;
    backlog?: boolean;
  } = {}
) {
  const repoId = options.repoId ?? (Object.keys(harness.state.repos)[0] || registerRepo(harness));
  const before = new Set(Object.keys(harness.state.tasks));
  harness.send({
    type: 'task.create',
    request: options.request ?? 'Fix the scroll in tab groups',
    repoId,
    priority: options.priority,
    waitsOn: options.waitsOn,
    stacksOn: options.stacksOn,
    planFirst: options.planFirst,
    backlog: options.backlog,
  });
  const taskId = Object.keys(harness.state.tasks).find((id) => !before.has(id)) ?? '';
  harness.send({
    type: 'task.triage',
    taskId,
    title: options.request ?? 'Fix tab group scroll',
    repoId,
    size: options.size ?? 'small',
    branch: `fix/${taskId}`,
    waitsOn: [options.triageWaitsOn ?? []].flat(),
  });
  readyWorktree(harness, taskId);
  return taskId;
}

export function verifySetup(harness: Harness, taskId: string, problems: ConfigProblem[] = []) {
  harness.send({ type: 'config.record', taskId, problems });
}

export function readyWorktree(harness: Harness, taskId: string) {
  if (harness.task(taskId).stage !== 'triage') return;
  verifySetup(harness, taskId);
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: `fix/${taskId}` });
}

export function approve(harness: Harness, taskId: string, response: string | null = null) {
  harness.send({ type: 'gate.answer', gateId: harness.openGate(taskId).id, decision: 'approve', response });
}

export function pushed(harness: Harness, taskId: string, sha = `sha-${harness.state.seq}`) {
  harness.send({ type: 'pull_request.record_push', taskId, sha });
}

export function reachShipping(harness: Harness, taskId: string) {
  reachReviewGate(harness, taskId);
  approve(harness, taskId);
  pushed(harness, taskId);
}

export function pushFix(harness: Harness, taskId: string, summary = 'Fixed it.') {
  const runId = harness.activeRun(taskId).id;
  harness.send({ type: 'agent.complete_fix', runId, summary, ...resolveReply(harness, runId) });
  pushed(harness, taskId);
}

export function shipAndMerge(harness: Harness, taskId: string) {
  reachShipping(harness, taskId);
  harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
}

function resolveHarnessPlan(harness: Harness, taskId: string, plan: PlanDocument) {
  const pipeline = resolveTaskPipeline(harness.task(taskId));
  const operates = pipeline.includes('operate') && plan.impact === undefined;
  const withImpact = operates ? { ...plan, impact: IMPACT } : plan;
  return plan === PLAN && !pipeline.includes('build') ? { ...withImpact, verification: [] } : withImpact;
}

export function proposePlan(harness: Harness, taskId: string, plan: PlanDocument = PLAN) {
  const document = resolveHarnessPlan(harness, taskId, plan);
  const runId = harness.activeRun(taskId).id;
  harness.send({ type: 'agent.propose_plan', runId, document, ...resolveReply(harness, runId) });
}

export function completePhase(harness: Harness, taskId: string, summary = 'Did the phase.') {
  const runId = harness.activeRun(taskId).id;
  harness.send({
    type: 'agent.complete_phase',
    runId,
    summary,
    spots: [{ file: 'src/a.ts', start: 1, end: 3, attention: 'critical', why: 'The change.' }],
    judgementCalls: [],
    ...resolveReply(harness, runId),
  });
}

export function buildAll(harness: Harness, taskId: string) {
  proposePlan(harness, taskId);
  const phases = harness.task(taskId).plan?.document?.phases.length ?? 1;
  for (let index = 0; index < phases; index += 1) completePhase(harness, taskId, `Phase ${index + 1} done.`);
}

export function reachReviewGate(harness: Harness, taskId: string) {
  buildAll(harness, taskId);
  harness.send({ type: 'checks.record', taskId, results: PASSING });
  harness.send({
    type: 'agent.report_review',
    runId: harness.activeRun(taskId).id,
    summary: null,
    findings: [],
  });
}

export function linkSession(harness: Harness, taskId: string, sessionId = 'session-1') {
  harness.send({ type: 'run.link', runId: harness.activeRun(taskId).id, sessionId, provider: 'claude' });
}
