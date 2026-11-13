import { describe, expect, test } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import {
  applyEvent,
  type ChatEvent,
  createState,
  decide,
  type Run,
  resolveHouseRules,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import { Effect, Layer, Result } from 'effect';
import { CLAUDE_CAPABILITIES } from '../../src/agents/providers/claude/index.ts';
import type { AgentProvider } from '../../src/agents/providers/index.ts';
import { Transcripts } from '../../src/agents/transcripts/service.ts';
import {
  isSessionCacheWarm,
  resolveRestorePlan,
  resolveTurnBrief,
  resolveTurnFold,
  resolveTurnPlan,
  resolveTurnPrompt as resolvePrompt,
} from '../../src/agents/turns/plan.ts';
import { type TurnContext } from '../../src/agents/turns/schema.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { runTest } from '../harness.ts';
import { createTestConfig } from '../helpers/index.ts';
import { createGate, createRepo, createRound, createRun, createTask } from '../helpers/state.ts';

function provider(overrides: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id: 'claude',
    label: 'Claude',
    capabilities: CLAUDE_CAPABILITIES,
    startSession: () => {
      throw new Error('not used');
    },
    listModels: Effect.succeed([]),
    complete: () => Effect.succeed(null),
    ...overrides,
  };
}

function createTranscripts() {
  return Effect.runSync(
    Transcripts.use(Effect.succeed).pipe(
      Effect.provide(
        Transcripts.layer.pipe(
          Layer.provide(Layer.merge(Layer.succeed(EngineConfig, createTestConfig()), BunServices.layer))
        )
      )
    )
  );
}

async function record(transcripts: Transcripts['Service'], runId: string, entry: ChatEvent) {
  await Effect.runPromise(transcripts.record(runId, entry));
}

function resolveTurnPrompt(...input: Parameters<typeof resolvePrompt>) {
  return Effect.runSync(resolvePrompt(...input));
}

function context(
  run: Run,
  runs: Run[],
  overrides: Partial<TurnContext> = {}
): TurnContext & { lost: string[] } {
  const state: ShinsaState = createState();
  for (const candidate of [...runs, run]) state.runs[candidate.id] = candidate;
  const lost: string[] = [];
  return {
    state,
    run,
    provider: provider(),
    cwd: '/work',
    transcripts: createTranscripts(),
    labelOf: (id) => id,
    recordLost: (sessionId) => Effect.sync(() => void lost.push(sessionId)),
    lost,
    ...overrides,
  };
}

describe('resolveTurnPlan', () => {
  test('a run without a session starts fresh', async () => {
    expect(await runTest(resolveTurnPlan(context(createRun(), [])))).toEqual({
      resume: null,
      fork: false,
      handoff: null,
      record: null,
    });
  });

  test('only the runs of this task that used the session, oldest first, make up the history', async () => {
    const run = createRun({ id: 'r3', sessionId: 's', sessionLost: true, startedAt: 30 });
    const runs = [
      createRun({ id: 'r2', sessionId: 's', startedAt: 20, endedAt: 25 }),
      createRun({ id: 'r1', sessionId: 's', startedAt: 10, endedAt: 15 }),
      createRun({ id: 'other-session', sessionId: 't', startedAt: 5, endedAt: 6 }),
      createRun({ id: 'other-task', taskId: 'task-9', sessionId: 's', startedAt: 1, endedAt: 2 }),
    ];
    const turn = context(run, runs);
    for (const id of ['r1', 'r2', 'other-session', 'other-task']) {
      await record(turn.transcripts, id, {
        type: 'user',
        from: 'shinsa',
        text: `brief of ${id}`,
        attachments: [],
      });
    }
    const plan = await runTest(resolveTurnPlan(turn));
    const text = plan.handoff?.text ?? '';
    expect(text.indexOf('brief of r1')).toBeLessThan(text.indexOf('brief of r2'));
    expect(text).not.toContain('other-session');
    expect(text).not.toContain('other-task');
    expect(plan.record).toMatchObject({ reason: 'session_restore', fromProvider: 'claude', totalEntries: 2 });
    expect(turn.lost).toEqual([]);
  });

  test('a session check that fails fails the plan with its message', async () => {
    const run = createRun({ sessionId: 's' });
    const turn = context(run, [], {
      provider: provider({
        inspectSession: () => Effect.die(new Error('The session store is unreadable.')),
      }),
    });
    await expect(runTest(resolveTurnPlan(turn))).rejects.toThrow('The session store is unreadable.');
  });

  test('a provider that is no longer registered is named by its id', async () => {
    const run = createRun({ sessionId: 's', sessionProvider: 'gemini' });
    const turn = context(run, [], { labelOf: (id) => (id === 'claude' ? 'Claude' : id) });
    await record(turn.transcripts, run.id, { type: 'user', from: 'shinsa', text: 'Brief.', attachments: [] });
    const plan = await runTest(resolveTurnPlan(turn));
    expect(plan.handoff?.text).toContain('from another coding agent (gemini)');
  });
});

describe('forking a task', () => {
  const fork = { taskId: 'source-task', runId: 'source-run', sessionId: 'source-session' };
  const source = createRun({
    id: 'source-run',
    taskId: 'source-task',
    sessionId: 'source-session',
    startedAt: 10,
    endedAt: 20,
    attempts: [
      {
        attemptId: 'a1',
        provider: 'claude',
        model: 'opus',
        resumed: false,
        handoff: null,
        cwd: '/source-worktree',
        startedAt: 10,
      },
    ],
  });

  async function forkContext(overrides: Partial<TurnContext> = {}) {
    const turn = context(createRun({ id: 'forked-run', fork, startedAt: 30 }), [source], overrides);
    await record(turn.transcripts, 'source-run', {
      type: 'user',
      from: 'shinsa',
      text: 'The source task’s brief.',
      attachments: [],
    });
    return turn;
  }

  test('the first run copies the source session when the provider can fork it and still has it', async () => {
    const inspected: string[] = [];
    const turn = await forkContext({
      provider: provider({
        inspectSession: (query) => {
          inspected.push(query.sessionId);
          return Effect.succeed('present');
        },
      }),
    });
    expect(await runTest(resolveTurnPlan(turn))).toEqual({
      resume: 'source-session',
      fork: true,
      handoff: null,
      record: null,
    });
    expect(inspected).toEqual(['source-session']);
  });

  test('a provider that cannot check its sessions forks without checking', async () => {
    const plan = await runTest(resolveTurnPlan(await forkContext()));
    expect(plan).toMatchObject({ resume: 'source-session', fork: true });
  });

  test('a source session the provider lost is restored from the source task’s transcript', async () => {
    const turn = await forkContext({
      provider: provider({ inspectSession: () => Effect.succeed('missing') }),
    });
    const plan = await runTest(resolveTurnPlan(turn));
    expect(plan).toMatchObject({ resume: null, fork: false });
    expect(plan.handoff?.text).toContain('The source task’s brief.');
    expect(plan.handoff?.text).toContain('the task this task was forked from');
    expect(plan.record).toMatchObject({ reason: 'fork', fromProvider: 'claude', totalEntries: 1 });
    expect(turn.lost).toEqual([]);
  });

  test('a provider that cannot fork gets the source task’s conversation as a handoff', async () => {
    const capabilities = { ...CLAUDE_CAPABILITIES, sessions: { resume: true, inspect: true, fork: false } };
    const plan = await runTest(resolveTurnPlan(await forkContext({ provider: provider({ capabilities }) })));
    expect(plan.record).toMatchObject({ reason: 'fork', fromProvider: 'claude' });
  });

  test('a source session on another provider is handed over instead of forked', async () => {
    const turn = await forkContext({ provider: provider({ id: 'codex', label: 'Codex' }) });
    const plan = await runTest(resolveTurnPlan(turn));
    expect(plan).toMatchObject({ resume: null, fork: false });
    expect(plan.record).toMatchObject({ reason: 'fork', fromProvider: 'claude' });
  });

  test('a fork the provider refuses mid-start is restored from the source task’s transcript', async () => {
    const turn = await forkContext();
    const plan = await runTest(
      resolveRestorePlan(
        turn,
        { resume: 'source-session', fork: true, handoff: null, record: null },
        'source-session'
      )
    );
    expect(plan.record).toMatchObject({ reason: 'fork', totalEntries: 1 });
    const own = await runTest(
      resolveRestorePlan(turn, { resume: 's', fork: false, handoff: null, record: null }, 's')
    );
    expect(own).toMatchObject({ resume: null, handoff: null });
  });

  test('the forked turn reads the source session’s house rules and is told where it works now', async () => {
    const rules = resolveHouseRules('agent');
    const turn = await forkContext();
    await record(turn.transcripts, 'source-run', {
      type: 'user',
      from: 'shinsa',
      text: rules,
      attachments: [],
    });
    const plan = { resume: 'source-session', fork: true, handoff: null, record: null };
    const prompt = resolveTurnPrompt(
      turn,
      plan,
      `${rules}\n\nThe instruction.`,
      `${rules}\n\nThe full brief.`
    );
    expect(prompt.startsWith('The instruction.')).toBe(true);
    expect(prompt).toContain('You now work in `/work`');
  });
});

describe('a message kept for the next agent', () => {
  function send(state: ShinsaState, command: ShinsaCommand, onBehalf = false) {
    const decision = Result.getOrThrow(decide(state, command, { now: 50, newId: () => 'fix-run', onBehalf }));
    return decision.events.reduce(
      (next, event) => applyEvent(next, { ...event, seq: next.seq + 1, at: 50 } as ShinsaEvent),
      state
    );
  }

  test('reaches a resumed session that already has the house rules', async () => {
    const rules = resolveHouseRules('agent');
    const built = createRun({
      id: 'built-run',
      status: 'running',
      sessionId: 'session-1',
      startedAt: 10,
      endedAt: 20,
      outcome: 'completed',
    });
    let state = createState();
    state.repos['repo-1'] = createRepo();
    state.tasks['task-1'] = createTask({
      stage: 'awaiting_review',
      activity: [],
      rounds: [createRound({ status: 'active' })],
    });
    state.runs[built.id] = built;
    state.gates['gate-1'] = createGate({ type: 'review', runId: null, title: 'Review' });
    state = send(state, { type: 'task.message', taskId: 'task-1', text: 'Keep the old flag.' }, true);
    state = send(state, { type: 'task.message', taskId: 'task-1', text: 'hello', kind: 'feedback' });
    const fix = state.runs['fix-run'];
    if (!fix) throw new Error('no fix run');
    expect(fix).toMatchObject({ purpose: 'fix', resume: true, sessionId: 'session-1' });
    const turn = context(fix, [built], { state });
    await record(turn.transcripts, 'built-run', {
      type: 'user',
      from: 'shinsa',
      text: rules,
      attachments: [],
    });
    const plan = { resume: 'session-1', fork: false, handoff: null, record: null };
    const prompt = resolveTurnPrompt(turn, plan, fix.prompt ?? '', resolveTurnBrief(state, fix, null));
    expect(prompt.startsWith(rules)).toBe(false);
    expect(prompt).toContain('hello');
    expect(prompt).toContain('- Sent by an agent on the human’s behalf: Keep the old flag.');
  });
});

describe('folding at a step boundary', () => {
  const resumed = { resume: 'session-1', fork: false, handoff: null, record: null };

  function folds(run: Run, overrides: Partial<Parameters<typeof resolveTurnFold>[0]> = {}) {
    return resolveTurnFold({
      run,
      plan: resumed,
      stepPrompt: true,
      firstAttempt: true,
      folds: true,
      ...overrides,
    });
  }

  test('the Agent’s resumed build, fix or operation turn folds on its first attempt with its own prompt', () => {
    for (const purpose of ['build', 'fix', 'operate'] as const) {
      expect(folds(createRun({ role: 'agent', purpose }))).toBe(true);
    }
  });

  test('planning, other roles, a fresh, forked or handed-over session, a later attempt or another prompt never fold', () => {
    const build = createRun({ role: 'agent', purpose: 'build' });
    expect(folds(createRun({ role: 'agent', purpose: 'plan' }))).toBe(false);
    expect(folds(createRun({ role: 'reviewer' }))).toBe(false);
    expect(folds(build, { folds: false })).toBe(false);
    expect(folds(build, { stepPrompt: false })).toBe(false);
    expect(folds(build, { firstAttempt: false })).toBe(false);
    expect(folds(build, { plan: { ...resumed, resume: null } })).toBe(false);
    expect(folds(build, { plan: { ...resumed, fork: true } })).toBe(false);
    const handoff = {
      text: 'Earlier.',
      totalEntries: 1,
      includedEntries: 1,
      elidedEntries: 0,
      approxTokens: 1,
    };
    expect(folds(build, { plan: { ...resumed, handoff } })).toBe(false);
    expect(folds(createRun({ role: 'agent', purpose: 'build', continues: 'run-0' }))).toBe(false);
  });

  test('a folded turn sends the round brief instead of the bare instruction, without the house rules it already has', async () => {
    const rules = resolveHouseRules('agent');
    const run = createRun({ id: 'run-2', sessionId: 'session-1', role: 'agent', purpose: 'build' });
    const earlier = createRun({ id: 'run-1', sessionId: 'session-1', role: 'agent', purpose: 'plan' });
    const turn = context(run, [earlier]);
    await record(turn.transcripts, 'run-1', { type: 'user', from: 'shinsa', text: rules, attachments: [] });
    const prompt = `${rules}\n\nNow build phase 1 of 2.`;
    const brief = `${rules}\n\nThe plan in full.\n\nNow build phase 1 of 2.`;
    expect(resolveTurnPrompt(turn, resumed, prompt, brief)).toBe('Now build phase 1 of 2.');
    expect(resolveTurnPrompt(turn, resumed, prompt, brief, true)).toBe(
      'The plan in full.\n\nNow build phase 1 of 2.'
    );
  });

  test('a session’s cache is warm until the expiry its last ended run recorded, and unknown counts as cold', () => {
    const run = createRun({ id: 'r3', sessionId: 's', startedAt: 30 });
    const older = createRun({ id: 'r1', sessionId: 's', startedAt: 10, cacheExpiresAt: 500 });
    const newer = createRun({ id: 'r2', sessionId: 's', startedAt: 20, cacheExpiresAt: 1_000 });
    expect(isSessionCacheWarm(context(run, [older, newer]), 's', 999)).toBe(true);
    expect(isSessionCacheWarm(context(run, [older, newer]), 's', 1_000)).toBe(false);
    expect(isSessionCacheWarm(context(run, []), 's', 0)).toBe(false);
    expect(isSessionCacheWarm(context({ ...run, cacheExpiresAt: 9_999 }, []), 's', 0)).toBe(false);
  });

  test('a cache written on another model is cold for this run, so a step on a new model folds first', () => {
    const run = createRun({ id: 'r2', sessionId: 's', startedAt: 20, model: 'opus' });
    const plan = createRun({
      id: 'r1',
      sessionId: 's',
      startedAt: 10,
      cacheExpiresAt: 1_000,
      model: 'fable',
    });
    expect(isSessionCacheWarm(context(run, [plan]), 's', 500)).toBe(false);
    expect(isSessionCacheWarm(context(run, [{ ...plan, model: 'opus' }]), 's', 500)).toBe(true);
  });

  test('an eunoe fold or cut keeps the session’s first message, so the house rules are not sent again; Claude Code’s own summary drops them', async () => {
    const rules = resolveHouseRules('agent');
    const run = createRun({ id: 'run-3', sessionId: 'session-1', role: 'agent', purpose: 'build' });
    const plan = createRun({
      id: 'run-1',
      sessionId: 'session-1',
      role: 'agent',
      purpose: 'plan',
      startedAt: 1,
    });
    const build = createRun({
      id: 'run-2',
      sessionId: 'session-1',
      role: 'agent',
      purpose: 'build',
      startedAt: 2,
    });
    const turn = context(run, [plan, build]);
    await record(turn.transcripts, 'run-1', { type: 'user', from: 'shinsa', text: rules, attachments: [] });
    const fold = { kind: 'compaction' as const, trigger: 'fold' as const, preTokens: null, summary: null };
    await record(turn.transcripts, 'run-2', { type: 'notice', notice: { ...fold, by: 'eunoe' as const } });
    const prompt = `${rules}\n\nNow build phase 2 of 2.`;
    const brief = `${rules}\n\nThe plan in full.\n\nNow build phase 2 of 2.`;
    const folded = 'The plan in full.\n\nNow build phase 2 of 2.';
    expect(resolveTurnPrompt(turn, resumed, prompt, brief, true)).toBe(folded);
    await record(turn.transcripts, 'run-2', {
      type: 'notice',
      notice: { ...fold, trigger: 'auto' as const },
    });
    expect(resolveTurnPrompt(turn, resumed, prompt, brief, true)).toBe(brief);
  });
});
