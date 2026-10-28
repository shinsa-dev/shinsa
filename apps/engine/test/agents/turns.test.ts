import { describe, expect, test } from 'bun:test';
import { createState, type Run, resolveHouseRules, type ShinsaState } from '@shinsa/core';
import { Transcripts } from '../../src/agents/index.ts';
import { CLAUDE_CAPABILITIES } from '../../src/agents/providers/claude/index.ts';
import type { AgentProvider } from '../../src/agents/providers/index.ts';
import {
  resolveRestorePlan,
  resolveTurnPlan,
  resolveTurnPrompt,
  type TurnContext,
} from '../../src/agents/turns.ts';
import { createTempDir } from '../helpers/index.ts';
import { createRun } from '../helpers/state.ts';

function provider(overrides: Partial<AgentProvider> = {}): AgentProvider {
  return {
    id: 'claude',
    label: 'Claude',
    capabilities: CLAUDE_CAPABILITIES,
    startSession: () => {
      throw new Error('not used');
    },
    listModels: () => Promise.resolve([]),
    complete: () => Promise.resolve(null),
    ...overrides,
  };
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
    transcripts: new Transcripts(createTempDir()),
    labelOf: (id) => id,
    recordLost: (sessionId) => {
      lost.push(sessionId);
      return Promise.resolve();
    },
    lost,
    ...overrides,
  };
}

describe('resolveTurnPlan', () => {
  test('a run without a session starts fresh', async () => {
    expect(await resolveTurnPlan(context(createRun(), []))).toEqual({
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
      turn.transcripts.record(id, { type: 'user', from: 'shinsa', text: `brief of ${id}`, attachments: [] });
    }
    const plan = await resolveTurnPlan(turn);
    const text = plan.handoff?.text ?? '';
    expect(text.indexOf('brief of r1')).toBeLessThan(text.indexOf('brief of r2'));
    expect(text).not.toContain('other-session');
    expect(text).not.toContain('other-task');
    expect(plan.record).toMatchObject({ reason: 'session_restore', fromProvider: 'claude', totalEntries: 2 });
    expect(turn.lost).toEqual([]);
  });

  test('a provider that is no longer registered is named by its id', async () => {
    const run = createRun({ sessionId: 's', sessionProvider: 'gemini' });
    const turn = context(run, [], { labelOf: (id) => (id === 'claude' ? 'Claude' : id) });
    turn.transcripts.record(run.id, { type: 'user', from: 'shinsa', text: 'Brief.', attachments: [] });
    const plan = await resolveTurnPlan(turn);
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

  function forkContext(overrides: Partial<TurnContext> = {}) {
    const turn = context(createRun({ id: 'forked-run', fork, startedAt: 30 }), [source], overrides);
    turn.transcripts.record('source-run', {
      type: 'user',
      from: 'shinsa',
      text: 'The source task’s brief.',
      attachments: [],
    });
    return turn;
  }

  test('the first run copies the source session when the provider can fork it and still has it', async () => {
    const inspected: string[] = [];
    const turn = forkContext({
      provider: provider({
        inspectSession: (query) => {
          inspected.push(query.sessionId);
          return Promise.resolve('present');
        },
      }),
    });
    expect(await resolveTurnPlan(turn)).toEqual({
      resume: 'source-session',
      fork: true,
      handoff: null,
      record: null,
    });
    expect(inspected).toEqual(['source-session']);
  });

  test('a provider that cannot check its sessions forks without checking', async () => {
    const plan = await resolveTurnPlan(forkContext());
    expect(plan).toMatchObject({ resume: 'source-session', fork: true });
  });

  test('a source session the provider lost is restored from the source task’s transcript', async () => {
    const turn = forkContext({ provider: provider({ inspectSession: () => Promise.resolve('missing') }) });
    const plan = await resolveTurnPlan(turn);
    expect(plan).toMatchObject({ resume: null, fork: false });
    expect(plan.handoff?.text).toContain('The source task’s brief.');
    expect(plan.handoff?.text).toContain('the task this task was forked from');
    expect(plan.record).toMatchObject({ reason: 'fork', fromProvider: 'claude', totalEntries: 1 });
    expect(turn.lost).toEqual([]);
  });

  test('a provider that cannot fork gets the source task’s conversation as a handoff', async () => {
    const capabilities = { ...CLAUDE_CAPABILITIES, sessions: { resume: true, inspect: true, fork: false } };
    const plan = await resolveTurnPlan(forkContext({ provider: provider({ capabilities }) }));
    expect(plan.record).toMatchObject({ reason: 'fork', fromProvider: 'claude' });
  });

  test('a source session on another provider is handed over instead of forked', async () => {
    const turn = forkContext({ provider: provider({ id: 'codex', label: 'Codex' }) });
    const plan = await resolveTurnPlan(turn);
    expect(plan).toMatchObject({ resume: null, fork: false });
    expect(plan.record).toMatchObject({ reason: 'fork', fromProvider: 'claude' });
  });

  test('a fork the provider refuses mid-start is restored from the source task’s transcript', () => {
    const turn = forkContext();
    const plan = resolveRestorePlan(
      turn,
      { resume: 'source-session', fork: true, handoff: null, record: null },
      'source-session'
    );
    expect(plan.record).toMatchObject({ reason: 'fork', totalEntries: 1 });
    const own = resolveRestorePlan(turn, { resume: 's', fork: false, handoff: null, record: null }, 's');
    expect(own).toMatchObject({ resume: null, handoff: null });
  });

  test('the forked turn reads the source session’s house rules and is told where it works now', () => {
    const rules = resolveHouseRules('agent');
    const turn = forkContext();
    turn.transcripts.record('source-run', { type: 'user', from: 'shinsa', text: rules, attachments: [] });
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
