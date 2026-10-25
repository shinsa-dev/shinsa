import { describe, expect, it } from 'bun:test';
import { applyOptimistic, isOptimistic } from '@/lib/connection/optimistic.ts';
import { createGate, createRepo, createShinsaState, createTask } from '../../support/state.ts';

describe('optimistic commands', () => {
  it('are the ones that settle the same way when they reach the server, or are refused there', () => {
    expect(isOptimistic({ type: 'gate.answer', gateId: 'g1', decision: 'approve', response: null })).toBe(
      true
    );
    expect(isOptimistic({ type: 'task.prioritize', taskId: 't1', priority: 'high' })).toBe(true);
    expect(isOptimistic({ type: 'task.create', request: 'New', repoId: null })).toBe(false);
    expect(isOptimistic({ type: 'task.message', taskId: 't1', text: 'Hi' })).toBe(false);
  });

  it('show what each command does on top of the state, with ids of their own, and skip one that would be refused', () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 't1', stage: 'triage', priority: 'normal' })],
      gates: [createGate({ id: 'g1', taskId: 't1', type: 'failure', status: 'open' })],
    });
    const shown = applyOptimistic(
      state,
      [
        { type: 'task.prioritize', taskId: 'missing', priority: 'high' },
        { type: 'task.prioritize', taskId: 't1', priority: 'urgent' },
        { type: 'task.cancel', taskId: 't1' },
      ],
      5_000
    );
    expect(shown.tasks.t1?.priority).toBe('urgent');
    expect(shown.tasks.t1?.stage).toBe('cancelled');
    expect(state.tasks.t1?.priority).toBe('normal');
    expect(applyOptimistic(state, [])).toBe(state);
  });

  it('give the runs a command starts ids of their own until the server names them', () => {
    const state = createShinsaState({
      repos: [createRepo({ id: 'r1' })],
      tasks: [createTask({ id: 't1', stage: 'building', repoId: 'r1', worktreePath: '/wt', branch: 'b' })],
      gates: [createGate({ id: 'g1', taskId: 't1', type: 'failure', status: 'open' })],
    });
    const shown = applyOptimistic(state, [
      { type: 'gate.answer', gateId: 'g1', decision: 'approve', response: null },
    ]);
    expect(shown.gates.g1?.status).not.toBe('open');
    expect(Object.keys(shown.runs)).toEqual([expect.stringMatching(/^optimistic-\d+$/)]);
    expect(Object.values(shown.runs)[0]).not.toHaveProperty('prompt');
  });

  it('show a fix a command starts the way the server sends it, without its prompt and with its focus', () => {
    const state = createShinsaState({
      repos: [createRepo({ id: 'r1' })],
      tasks: [
        createTask({ id: 't1', stage: 'awaiting_review', repoId: 'r1', worktreePath: '/wt', branch: 'b' }),
      ],
      gates: [createGate({ id: 'g1', taskId: 't1', type: 'review', status: 'open' })],
    });
    const shown = applyOptimistic(state, [
      { type: 'gate.answer', gateId: 'g1', decision: 'revise', response: 'Rename the button.' },
    ]);
    const fix = Object.values(shown.runs)[0];
    expect(fix).toMatchObject({ purpose: 'fix', fixFocus: 'changes' });
    expect(fix).not.toHaveProperty('prompt');
    expect(fix).not.toHaveProperty('rolePrompt');
  });
});
