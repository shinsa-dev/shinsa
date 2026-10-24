import { describe, expect, test } from 'bun:test';
import { createState, type Run, type ShinsaState } from '@shinsa/core';
import { Transcripts } from '../../src/agents/index.ts';
import { CLAUDE_CAPABILITIES } from '../../src/agents/providers/claude/index.ts';
import type { AgentProvider } from '../../src/agents/providers/index.ts';
import { resolveTurnPlan, type TurnContext } from '../../src/agents/turns.ts';
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
