import { describe, expect, it } from 'bun:test';
import type { Gate, Task } from '@shinsa/core';
import { resolveTaskNow } from '@/lib/tasks/now.ts';
import { createGate, createShinsaState, createTask, NOW } from '../../support/state.ts';

type PlanDocument = NonNullable<NonNullable<Task['spec']>['document']>;
type WorkReport = NonNullable<Task['report']>;
type PullRequest = NonNullable<Task['pullRequest']>;

function plan(...titles: string[]): Task['spec'] {
  const document: PlanDocument = {
    goal: 'Goal',
    plan: titles.map((title) => ({ title, detail: '' })),
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [],
    questions: [],
  };
  return { version: 1, body: '', document, proposedAt: NOW };
}

const PULL_REQUEST: PullRequest = {
  number: 42,
  url: 'https://github.com/acme/app/pull/42',
  state: 'open',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: NOW,
};

function nowFor(task: Partial<Task>, gate?: Partial<Gate>, others: Task[] = []) {
  const subject = createTask({ id: 't', ...task });
  const gates = gate ? [createGate({ id: 'g', taskId: 't', ...gate })] : [];
  return resolveTaskNow(createShinsaState({ tasks: [subject, ...others], gates }), subject);
}

describe('resolveTaskNow', () => {
  it('counts the phases of a plan to approve', () => {
    expect(nowFor({ spec: plan('One') }, { kind: 'spec' })).toBe('1 phase to approve');
    expect(nowFor({ spec: plan('One', 'Two') }, { kind: 'spec' })).toBe('2 phases to approve');
    expect(nowFor({}, { kind: 'spec' })).toBe('Plan to approve');
  });

  it('uses the report headline for a review, or says the checks and review were clean', () => {
    const report = { headline: 'Adds the login form', phases: [], checks: [], decisions: [] } as WorkReport;
    expect(nowFor({ report }, { kind: 'review' })).toBe('Adds the login form');
    expect(nowFor({}, { kind: 'review' })).toBe('Checks passed, agent review clean');
  });

  it('names the clean pull request for a merge', () => {
    expect(nowFor({ pullRequest: PULL_REQUEST }, { kind: 'merge' })).toBe('PR #42 is clean');
    expect(nowFor({}, { kind: 'merge' })).toBe('Clean and ready to merge');
  });

  it('shows the gate title for a question, an agent question and a failure', () => {
    expect(nowFor({}, { kind: 'question', title: 'Which retry scope?' })).toBe('Which retry scope?');
    expect(nowFor({}, { kind: 'review', purpose: 'agent_question', title: 'Keep the old API?' })).toBe(
      'Keep the old API?'
    );
    expect(nowFor({}, { purpose: 'failure', title: 'Out of automatic fix rounds' })).toBe(
      'Out of automatic fix rounds'
    );
  });

  it('names the task it waits on', () => {
    const base = createTask({ id: 'base', title: 'Add login' });
    expect(nowFor({ stage: 'queued', waitsOn: ['base'] }, undefined, [base])).toBe('Waits on “Add login”');
  });

  it('names the active phase while building', () => {
    const task = {
      spec: plan('Set up', 'Wire the form'),
      phases: [
        { status: 'done' as const, at: NOW },
        { status: 'active' as const, at: NOW },
      ],
    };
    expect(nowFor({ ...task, stage: 'building' })).toBe('Wire the form');
    expect(nowFor({ ...task, stage: 'checking', stageReason: 'running the checks' })).toBe(
      'Running the checks'
    );
  });

  it('falls back to the stage reason when no phase is active or there is no plan', () => {
    expect(nowFor({ stage: 'building', stageReason: 'building the change' })).toBe('Building the change');
    expect(nowFor({ stage: 'building', spec: plan('Only'), phases: [{ status: 'done', at: NOW }] })).toBe(
      'Building the change'
    );
  });

  it('names the merged pull request', () => {
    expect(nowFor({ stage: 'merged', pullRequest: PULL_REQUEST })).toBe('PR #42 merged');
    expect(nowFor({ stage: 'merged', stageReason: 'merged' })).toBe('Merged');
  });
});
