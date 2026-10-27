import { describe, expect, it } from 'bun:test';
import type { Gate, Task } from '@shinsa/core';
import { resolveTaskNow } from '@/lib/tasks/now.ts';
import { createGate, createShinsaState, createTask, NOW } from '../../support/state.ts';

type PlanDocument = NonNullable<NonNullable<Task['plan']>['document']>;
type WorkReport = NonNullable<Task['report']>;
type PullRequest = NonNullable<Task['pullRequest']>;

function plan(...titles: string[]): Task['plan'] {
  const document: PlanDocument = {
    goal: 'Goal',
    phases: titles.map((title) => ({ title, detail: '' })),
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
    expect(nowFor({ plan: plan('One') }, { type: 'plan' })).toBe('1 phase to approve');
    expect(nowFor({ plan: plan('One', 'Two') }, { type: 'plan' })).toBe('2 phases to approve');
    expect(nowFor({}, { type: 'plan' })).toBe('Plan to approve');
  });

  it('uses the report headline for a review, or says the checks and review were clean', () => {
    const report = {
      headline: 'Adds the login form',
      sections: [],
      checks: [],
      judgementCalls: [],
    } as WorkReport;
    expect(nowFor({ report }, { type: 'review' })).toBe('Adds the login form');
    expect(nowFor({}, { type: 'review' })).toBe('Checks passed, agent review clean');
  });

  it('names the clean pull request for a merge', () => {
    expect(nowFor({ pullRequest: PULL_REQUEST }, { type: 'merge' })).toBe('PR #42 is clean');
    expect(nowFor({}, { type: 'merge' })).toBe('Clean and ready to merge');
  });

  it('counts the steps before the merge, and names the merged pull request after it', () => {
    const step = {
      when: 'pre_merge' as const,
      kind: 'env' as const,
      title: 'Set A',
      detail: 'd',
      command: null,
    };
    const walkthrough = {
      approach: 'a',
      flow: 'f',
      risks: [],
      testing: { automated: [], manual: [] },
      steps: [step],
    };
    const phaseReports = [{ index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 }];
    expect(nowFor({ phaseReports }, { type: 'merge' })).toBe('1 step to do before the merge');
    const merged = { ...PULL_REQUEST, state: 'merged' as const };
    expect(nowFor({ pullRequest: merged }, { type: 'post_merge' })).toBe('PR #42 merged');
    expect(nowFor({}, { type: 'post_merge' })).toBe('Merged');
  });

  it('shows the gate title for a question, a secret request and a failure', () => {
    expect(nowFor({}, { type: 'question', title: 'Which retry scope?' })).toBe('Which retry scope?');
    expect(nowFor({}, { type: 'secret', title: 'The test needs a Stripe key.' })).toBe(
      'The test needs a Stripe key.'
    );
    expect(nowFor({}, { type: 'failure', title: 'Out of automatic fix rounds' })).toBe(
      'Out of automatic fix rounds'
    );
  });

  it('names the task it waits on', () => {
    const base = createTask({ id: 'base', title: 'Add login' });
    expect(nowFor({ stage: 'waiting_on_tasks', waitsOn: ['base'] }, undefined, [base])).toBe(
      'Waits on “Add login”'
    );
  });

  it('names the active phase while building', () => {
    const task = {
      plan: plan('Set up', 'Wire the form'),
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
    expect(nowFor({ stage: 'building', plan: plan('Only'), phases: [{ status: 'done', at: NOW }] })).toBe(
      'Building the change'
    );
  });

  it('names the merged pull request', () => {
    expect(nowFor({ stage: 'merged', pullRequest: PULL_REQUEST })).toBe('PR #42 merged');
    expect(nowFor({ stage: 'merged', stageReason: 'merged' })).toBe('Merged');
  });
});
