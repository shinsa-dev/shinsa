import { describe, expect, test } from 'bun:test';
import {
  isDelegatedRun,
  isReadOnlyRole,
  type Run,
  type RunDelegation,
  resolveDelegationStatus,
} from '../../src/index.ts';

const DELEGATION: RunDelegation = {
  parentRunId: 'parent',
  depth: 1,
  requestKey: 'k',
  title: 'Check',
  brief: 'Check it.',
  mode: 'async',
  wake: 'always',
  isolation: 'shared',
  baseCommit: null,
  delivery: 'none',
  question: null,
  requestedAt: 0,
};

function delegated(patch: Partial<Run> = {}, delegation: Partial<RunDelegation> = {}) {
  const run: Run = {
    id: 'child',
    taskId: 't',
    role: 'reviewer',
    status: 'running',
    provider: 'claude',
    model: null,
    sessionId: null,
    startedAt: 0,
    endedAt: null,
    outcome: null,
    summary: null,
    delegation: { ...DELEGATION, ...delegation },
    ...patch,
  };
  if (!isDelegatedRun(run)) throw new Error('not delegated');
  return run;
}

describe('delegated runs', () => {
  test('only planners, reviewers and answerers are read-only', () => {
    expect(['planner', 'reviewer', 'answerer'].every((role) => isReadOnlyRole(role as Run['role']))).toBe(
      true
    );
    expect(['builder', 'fixer', 'shipper'].some((role) => isReadOnlyRole(role as Run['role']))).toBe(false);
  });

  test('a run is delegated when it carries a delegation', () => {
    expect(isDelegatedRun({ ...delegated(), delegation: null })).toBe(false);
    expect(isDelegatedRun(delegated())).toBe(true);
  });

  test('its status reads what the parent needs to know', () => {
    expect(resolveDelegationStatus(delegated({ status: 'queued' }))).toBe('queued');
    expect(resolveDelegationStatus(delegated())).toBe('running');
    expect(resolveDelegationStatus(delegated({ status: 'waiting' }))).toBe('waiting');
    const question = {
      id: 'q',
      question: 'Which?',
      context: null,
      choices: [],
      recommendation: null,
      askedAt: 0,
      delivered: false,
      answer: null,
      answeredAt: null,
    };
    expect(resolveDelegationStatus(delegated({}, { question }))).toBe('waiting');
    expect(resolveDelegationStatus(delegated({}, { question: { ...question, answer: 'A' } }))).toBe(
      'running'
    );
    expect(resolveDelegationStatus(delegated({ endedAt: 1, outcome: 'completed' }))).toBe('completed');
    expect(resolveDelegationStatus(delegated({ endedAt: 1, outcome: 'cancelled' }))).toBe('cancelled');
    expect(resolveDelegationStatus(delegated({ endedAt: 1 }))).toBe('failed');
  });
});
