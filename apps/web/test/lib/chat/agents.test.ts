import { describe, expect, it } from 'bun:test';
import type { Run } from '@shinsa/core';
import { describeAgentCount, listTaskAgents } from '@/lib/chat/agents.ts';
import { createRun, createShinsaState, createTask } from '../../support/state.ts';

function delegated(id: string, parentRunId: string, depth: number, overrides: Partial<Run> = {}) {
  return createRun({
    id,
    taskId: 't',
    role: 'reviewer',
    startedAt: 50 + depth,
    delegation: {
      parentRunId,
      depth,
      requestKey: id,
      title: `Check ${id}`,
      brief: 'Look.',
      mode: 'async',
      wake: 'always',
      isolation: 'shared',
      baseCommit: null,
      delivery: 'none',
      question: null,
      requestedAt: 0,
    },
    ...overrides,
  });
}

describe('who worked on a task', () => {
  it('lists the round agent once with every delegation of its runs, then the reviewer and the answerer', () => {
    const task = createTask({ id: 't' });
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'p', taskId: 't', purpose: 'plan', startedAt: 1, endedAt: 2, outcome: 'completed' }),
        createRun({
          id: 'b1',
          taskId: 't',
          purpose: 'build',
          startedAt: 3,
          endedAt: 4,
          outcome: 'completed',
        }),
        createRun({ id: 'r', taskId: 't', role: 'reviewer', startedAt: 5, endedAt: 6, outcome: 'completed' }),
        createRun({ id: 'b2', taskId: 't', purpose: 'fix', startedAt: 7 }),
        createRun({ id: 'q', taskId: 't', role: 'answerer', startedAt: 8, endedAt: 9, outcome: 'completed' }),
        delegated('d1', 'b2', 1, { role: 'builder' }),
        delegated('d2', 'd1', 2, { endedAt: 60, outcome: 'failed' }),
        delegated('d3', 'b1', 1, { endedAt: 60, outcome: 'cancelled' }),
        delegated('d4', 'b1', 1, { role: 'planner', endedAt: 60, outcome: 'completed' }),
        createRun({ id: 'other', taskId: 'x', role: 'answerer', startedAt: 1 }),
      ],
    });
    const agents = listTaskAgents(state, task);
    expect(agents.map((agent) => [agent.name, agent.label, agent.detail, agent.depth, agent.runId])).toEqual([
      ['Agent', null, '3 runs · working now', 0, 'b2'],
      ['Reviewer', 'Check d3', 'Stopped', 1, 'd3'],
      ['Planner', 'Check d4', 'Finished', 1, 'd4'],
      ['Builder', 'Check d1', 'Working now', 1, 'd1'],
      ['Reviewer', 'Check d2', 'Failed', 2, 'd2'],
      ['Reviewer', null, '1 run', 0, 'r'],
      ['Answerer', null, '1 run', 0, 'q'],
    ]);
    expect(agents[0]?.live).toBe(true);
    expect(agents[0]?.icon).toBe('IconAgent');
    expect(describeAgentCount(agents)).toBe('7 agents');
  });

  it('is empty before any agent ran', () => {
    const task = createTask({ id: 't' });
    expect(listTaskAgents(createShinsaState({ tasks: [task] }), task)).toEqual([]);
  });
});
