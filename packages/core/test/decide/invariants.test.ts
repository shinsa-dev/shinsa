import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createState,
  DomainError,
  decide,
  type GateDecision,
  isDependencyOf,
  isTaskSettled,
  listActiveRuns,
  listOpenBlockers,
  listOpenGates,
  listPendingDependencies,
  type PullRequest,
  type ReportCheck,
  type ReviewFinding,
  RUN_STAGES,
  replayEvents,
  resolveLiveness,
  resolveQueue,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '../../src/index.ts';
import { SPEC } from '../harness.ts';

type Random = () => number;

function createRandom(seed: number): Random {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function chance(random: Random, odds: number) {
  return random() < odds;
}

function sample<T>(random: Random, items: readonly T[]) {
  return items.filter(() => chance(random, 0.04)).slice(0, 2);
}

const SEEDS = 30;

const STEPS = 400;

const DECISIONS: GateDecision[] = ['approve', 'approve', 'approve', 'approve', 'revise', 'answer', 'reject'];

function randomChecks(random: Random): ReportCheck[] {
  return [
    { name: 'lint', outcome: chance(random, 0.7) ? 'pass' : 'fail', detail: null },
    {
      name: pick(random, ['types', 'tests']) ?? 'types',
      outcome: chance(random, 0.8) ? 'pass' : 'fail',
      detail: 'x',
    },
  ];
}

function randomFindings(random: Random): ReviewFinding[] {
  if (chance(random, 0.6)) return [];
  return [
    {
      severity: chance(random, 0.6) ? 'blocking' : 'suggestion',
      file: pick(random, ['a.ts', 'b.ts', null]) ?? null,
      line: 1,
      message: 'Look here.',
    },
  ];
}

function randomPullRequest(random: Random): PullRequest {
  return {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    state: chance(random, 0.85) ? 'open' : chance(random, 0.7) ? 'merged' : 'closed',
    checks: pick(random, ['passing', 'passing', 'passing', 'failing', 'pending', 'none']) ?? 'passing',
    unresolvedComments: chance(random, 0.9) ? 0 : 1,
    mergeable: pick(random, [true, true, true, false, null]) ?? true,
    headSha: chance(random, 0.9) ? null : 'stale',
    updatedAt: 0,
  };
}

function listAgentCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const commands: ShinsaCommand[] = [];
  for (const run of Object.values(state.runs)) {
    const runId = run.id;
    if (run.endedAt !== null) {
      if (chance(random, 0.05)) commands.push({ type: 'agent.note', runId, note: 'Late.' });
      continue;
    }
    switch (run.role) {
      case 'planner':
        commands.push({ type: 'agent.propose_plan', runId, document: SPEC });
        break;
      case 'builder':
        commands.push({ type: 'agent.complete_phase', runId, summary: 'Done.', spots: [], decisions: [] });
        break;
      case 'reviewer':
        commands.push({ type: 'agent.report_review', runId, findings: randomFindings(random) });
        break;
      default:
        commands.push({ type: 'agent.complete_fix', runId, summary: 'Fixed.' });
    }
    if (chance(random, 0.3)) {
      commands.push({
        type: 'agent.ask',
        runId,
        gateId: `q-${state.seq}`,
        question: 'Which one?',
        context: null,
      });
    }
    commands.push(
      { type: 'agent.note', runId, note: 'Working.' },
      {
        type: 'run.end',
        runId,
        outcome: pick(random, ['completed', 'failed', 'cancelled']) ?? 'failed',
        summary: null,
      },
      { type: 'run.link', runId, sessionId: `s-${runId}` }
    );
  }
  return commands;
}

function listSystemCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const commands: ShinsaCommand[] = [];
  const taskIds = Object.keys(state.tasks);
  for (const task of Object.values(state.tasks)) {
    const taskId = task.id;
    if (task.stage === 'triage' && task.branch === null) {
      commands.push({
        type: 'task.triage',
        taskId,
        title: `Task ${taskId}`,
        repoId: 'repo',
        size: chance(random, 0.5) ? 'large' : 'small',
        branch: `b-${taskId}`,
        dependsOn: sample(random, taskIds),
      });
    }
    if (task.stage === 'triage' && task.branch !== null) {
      commands.push({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: task.branch });
    }
    if (task.stage === 'checking')
      commands.push({ type: 'checks.record', taskId, results: randomChecks(random) });
    if (task.pushPending) commands.push({ type: 'pull_request.pushed', taskId, sha: `sha-${state.seq}` });
    if (task.stage === 'shipping' || task.stage === 'awaiting_merge' || chance(random, 0.02)) {
      commands.push({ type: 'pull_request.record', taskId, pullRequest: randomPullRequest(random) });
    }
    if (chance(random, 0.03))
      commands.push({ type: 'effect.fail', taskId, title: 'Effect failed', detail: 'x' });
    if (task.worktreePath && isTaskSettled(task)) commands.push({ type: 'worktree.gone', taskId });
    if (chance(random, 0.03)) commands.push({ type: 'message.deliver', taskId, text: 'Missed steer.' });
  }
  commands.push({ type: 'runs.dispatch' });
  return commands;
}

function listUserCommands(state: ShinsaState, random: Random): ShinsaCommand[] {
  const taskIds = Object.keys(state.tasks);
  const commands: ShinsaCommand[] = [
    {
      type: 'task.create',
      intent: 'Do something',
      repoId: 'repo',
      priority: pick(random, ['urgent', 'high', 'normal', 'low']),
      blockedBy: sample(random, taskIds),
    },
  ];
  const open = Object.values(state.tasks).filter((task) => !isTaskSettled(task));
  for (const gate of listOpenGates(state)) {
    const other = pick(
      random,
      open.filter((task) => task.id !== gate.taskId)
    );
    if (other && gate.kind === 'merge') {
      commands.push({ type: 'task.block', taskId: gate.taskId, blockedBy: [other.id] });
    }
    commands.push({
      type: 'gate.answer',
      gateId: gate.id,
      decision: pick(random, DECISIONS) ?? 'approve',
      response: chance(random, 0.7) ? 'Sounds right.' : null,
    });
  }
  const taskId = pick(random, taskIds);
  if (taskId) {
    commands.push(
      { type: 'task.message', taskId, text: 'Also this.' },
      { type: 'task.retry', taskId },
      { type: 'task.prioritize', taskId, priority: pick(random, ['high', 'low']) ?? 'low' }
    );
    if (chance(random, 0.3))
      commands.push({ type: 'task.block', taskId, blockedBy: sample(random, taskIds) });
    if (chance(random, 0.08)) commands.push({ type: 'task.cancel', taskId });
    if (chance(random, 0.04)) commands.push({ type: 'task.complete', taskId });
  }
  if (chance(random, 0.05)) {
    commands.push({
      type: 'settings.change',
      patch: { approvePlans: chance(random, 0.5), maxFixRounds: pick(random, [null, 1, 3]) ?? null },
    });
  }
  return commands;
}

function nextCommand(state: ShinsaState, random: Random): ShinsaCommand {
  const roll = random();
  const pool =
    roll < 0.45
      ? listAgentCommands(state, random)
      : roll < 0.8
        ? listSystemCommands(state, random)
        : listUserCommands(state, random);
  return pick(random, pool) ?? { type: 'runs.dispatch' };
}

function assertInvariants(state: ShinsaState, now: number) {
  const queue = resolveQueue(state, now);
  const seen = new Map<string, string>();
  const place = (taskId: string, where: string) => {
    const previous = seen.get(taskId);
    if (previous && previous !== where) throw new Error(`${taskId} is both ${previous} and ${where}`);
    seen.set(taskId, where);
  };
  for (const entry of [...queue.ready, ...queue.held]) place(entry.task.id, 'deciding');
  for (const task of queue.working) place(task.id, 'working');
  for (const task of queue.waiting) place(task.id, 'waiting');

  for (const task of Object.values(state.tasks)) {
    const runs = listActiveRuns(state, task.id);
    const gates = listOpenGates(state, task.id);
    const kinds = (kind: string) => gates.filter((gate) => gate.kind === kind && gate.purpose === 'decision');
    const context = `${task.id} at ${task.stage} (${task.stageReason})`;

    expect(runs.length, context).toBeLessThanOrEqual(1);
    expect(
      runs.every((run) => run.status === 'running'),
      context
    ).toBe(true);
    expect(resolveLiveness(state, task), context).not.toBeNull();
    expect(task.blockedBy.includes(task.id), context).toBe(false);
    expect(
      task.blockedBy.some((id) => isDependencyOf(state, task.id, id)),
      context
    ).toBe(false);

    if (isTaskSettled(task)) {
      expect(runs, context).toHaveLength(0);
      expect(gates, context).toHaveLength(0);
      continue;
    }
    if (runs.length > 0) {
      expect(RUN_STAGES.has(task.stage), context).toBe(true);
      expect(
        gates.every((gate) => gate.purpose === 'agent_question' && gate.runId === runs[0]?.id),
        context
      ).toBe(true);
    }
    for (const gate of gates.filter((open) => open.purpose === 'agent_question')) {
      expect(
        runs.some((run) => run.id === gate.runId),
        context
      ).toBe(true);
    }
    expect(gates.filter((gate) => gate.purpose === 'failure').length, context).toBeLessThanOrEqual(1);
    for (const kind of ['spec', 'review', 'merge']) {
      expect(kinds(kind).length, context).toBeLessThanOrEqual(1);
    }
    expect(kinds('spec').length === 1, context).toBe(task.stage === 'awaiting_spec');
    expect(kinds('review').length === 1, context).toBe(task.stage === 'awaiting_review');
    if (kinds('merge').length === 1) {
      expect(task.stage, context).toBe('awaiting_merge');
      expect(listOpenBlockers(state, task), context).toHaveLength(0);
    }
    if (task.stage === 'queued') {
      expect(listPendingDependencies(state, task).length > 0 || gates.length > 0, context).toBe(true);
    }
  }
}

function simulate(seed: number, steps: number) {
  const random = createRandom(seed);
  let state = createState();
  state = applyEvent(state, {
    type: 'repo.registered',
    repo: {
      id: 'repo',
      name: 'shinsa',
      path: '/code/shinsa',
      defaultBranch: 'main',
      remote: null,
      areaId: null,
      checkCommands: [],
      previewCommand: null,
    },
    seq: 1,
    at: 0,
  });
  const log: ShinsaEvent[] = [{ type: 'repo.registered', repo: state.repos.repo!, seq: 1, at: 0 }];
  let counter = 0;
  for (let step = 0; step < steps; step += 1) {
    const now = 1_000 + step;
    const command = nextCommand(state, random);
    const before = JSON.stringify(state);
    const context = { now, newId: () => `${seed}-${++counter}` };
    let decision: ReturnType<typeof decide>;
    try {
      decision = decide(state, command, context);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      expect(JSON.stringify(state)).toBe(before);
      continue;
    }
    expect(JSON.stringify(state), `decide mutated its input on ${command.type}`).toBe(before);
    for (const event of decision.events) {
      const stamped = { ...event, seq: state.seq + 1, at: now } as ShinsaEvent;
      log.push(stamped);
      state = applyEvent(state, stamped);
    }
    try {
      assertInvariants(state, now);
    } catch (error) {
      throw new Error(`seed ${seed}, step ${step}, after ${JSON.stringify(command)}: ${String(error)}`);
    }
  }
  expect(replayEvents(log)).toEqual(state);
  return state;
}

describe('decide under random command sequences', () => {
  test('keeps every invariant, and replaying the log rebuilds the same state', () => {
    let settled = 0;
    for (let seed = 1; seed <= SEEDS; seed += 1) {
      const state = simulate(seed, STEPS);
      settled += Object.values(state.tasks).filter((task) => task.stage === 'merged').length;
    }
    expect(settled).toBeGreaterThan(0);
  }, 60_000);

  test('is deterministic for the same state, command, clock and ids', () => {
    const random = createRandom(7);
    let state = simulate(7, 120);
    for (let step = 0; step < 50; step += 1) {
      const command = nextCommand(state, random);
      const attempt = () => {
        let counter = 0;
        try {
          return JSON.stringify(decide(state, command, { now: 5_000, newId: () => `d-${++counter}` }));
        } catch (error) {
          return String(error);
        }
      };
      expect(attempt()).toBe(attempt());
      let counter = 0;
      const result = (() => {
        try {
          return decide(state, command, { now: 5_000, newId: () => `d-${step}-${++counter}` });
        } catch {
          return null;
        }
      })();
      if (!result) continue;
      for (const event of result.events)
        state = applyEvent(state, { ...event, seq: state.seq + 1, at: 5_000 } as ShinsaEvent);
    }
  });
});
