import { describe, expect, it } from 'bun:test';
import type { Run, PlanDocument, Task } from '@shinsa/core';
import { ROLE_LABEL, resolveRunHeadline } from '@/lib/chat/run-role.ts';
import { createCallEntry, shinsaTool } from '../../support/chat.ts';
import { createRun, createTask, NOW } from '../../support/state.ts';

function document(titles: string[]): PlanDocument {
  return {
    goal: 'Goal',
    plan: titles.map((title) => ({ title, detail: `${title} detail` })),
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [],
    questions: [],
  };
}

function withPlan(titles: string[]): Task {
  return createTask({ id: 't', spec: { version: 1, body: '', document: document(titles), proposedAt: NOW } });
}

const task = createTask({ id: 't' });

function live(overrides: Partial<Run>) {
  return createRun({ id: 'r', taskId: 't', ...overrides });
}

function done(overrides: Partial<Run>) {
  return createRun({ id: 'r', taskId: 't', endedAt: NOW, outcome: 'completed', ...overrides });
}

describe('ROLE_LABEL', () => {
  it('names each role by the step it does, with shipping fixes shown as fixes', () => {
    expect(ROLE_LABEL).toEqual({
      triage: 'Setup',
      planner: 'Plan',
      builder: 'Build',
      reviewer: 'Review',
      fixer: 'Fix',
      shipper: 'Fix',
      answerer: 'Answer',
      investigator: 'Investigate',
      researcher: 'Research',
      operator: 'Run',
    });
  });
});

describe('resolveRunHeadline', () => {
  it('describes an answerer while it works and once it answered', () => {
    expect(resolveRunHeadline(live({ role: 'answerer' }), task, [])).toBe('Answering your question');
    expect(resolveRunHeadline(done({ role: 'answerer' }), task, [])).toBe('Answered your question');
  });

  it('describes an investigation, research and an operation while they work and once they hand over', () => {
    expect(resolveRunHeadline(live({ role: 'investigator' }), task, [])).toBe('Investigating');
    expect(resolveRunHeadline(done({ role: 'investigator' }), task, [])).toBe('Reported the findings');
    expect(resolveRunHeadline(live({ role: 'researcher' }), task, [])).toBe('Researching');
    expect(resolveRunHeadline(done({ role: 'researcher' }), task, [])).toBe('Wrote the report');
    expect(resolveRunHeadline(live({ role: 'operator' }), task, [])).toBe('Running the operation');
    expect(resolveRunHeadline(done({ role: 'operator' }), task, [])).toBe('Reported the outcome');
  });

  it('describes triage while it runs and once it is done', () => {
    expect(resolveRunHeadline(live({ role: 'triage' }), task, [])).toBe('Sorting the task');
    expect(resolveRunHeadline(done({ role: 'triage' }), task, [])).toBe('Sorted the task');
  });

  it('keeps the present tense for a run that failed or was stopped', () => {
    expect(resolveRunHeadline(done({ role: 'triage', outcome: 'failed' }), task, [])).toBe(
      'Sorting the task'
    );
    expect(resolveRunHeadline(done({ role: 'planner', outcome: 'cancelled' }), task, [])).toBe(
      'Planning the work'
    );
  });

  it('counts the phases of the plan the planner proposed last', () => {
    const entries = [
      createCallEntry('1', shinsaTool('propose_plan', { plan: [{ title: 'a' }] }), 1),
      createCallEntry(
        '2',
        shinsaTool('propose_plan', { plan: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }),
        2
      ),
    ];
    expect(resolveRunHeadline(live({ role: 'planner' }), task, entries)).toBe('Planning the work');
    expect(resolveRunHeadline(done({ role: 'planner' }), task, entries)).toBe('Planned 3 phases');
  });

  it('falls back to the plan on the task, then to a plain headline', () => {
    expect(resolveRunHeadline(done({ role: 'planner' }), withPlan(['Only']), [])).toBe('Planned 1 phase');
    expect(resolveRunHeadline(done({ role: 'planner' }), task, [])).toBe('Planned the work');
  });

  it('names the phase a builder works on', () => {
    const planned = withPlan(['Add the form', 'Wire the API']);
    expect(resolveRunHeadline(live({ role: 'builder', phaseIndex: 1 }), planned, [])).toBe(
      'Phase 2 of 2: Wire the API'
    );
    expect(resolveRunHeadline(done({ role: 'builder', phaseIndex: 0 }), planned, [])).toBe(
      'Phase 1 of 2: Add the form'
    );
  });

  it('describes a builder without a phase in the plan as building the change', () => {
    const planned = withPlan(['Add the form']);
    expect(resolveRunHeadline(live({ role: 'builder' }), planned, [])).toBe('Building the change');
    expect(resolveRunHeadline(done({ role: 'builder', phaseIndex: null }), task, [])).toBe(
      'Built the change'
    );
    expect(resolveRunHeadline(live({ role: 'builder', phaseIndex: 4 }), planned, [])).toBe(
      'Building the change'
    );
  });

  it('sums up the review the reviewer reported', () => {
    const review = (findings: unknown[]) => [
      createCallEntry('1', shinsaTool('report_review', { findings }), 1),
    ];
    expect(resolveRunHeadline(live({ role: 'reviewer' }), task, review([]))).toBe('Reviewing the change');
    expect(resolveRunHeadline(done({ role: 'reviewer' }), task, [])).toBe('Reviewed the change');
    expect(resolveRunHeadline(done({ role: 'reviewer' }), task, review([]))).toBe(
      'Reviewed the change, no findings'
    );
    expect(resolveRunHeadline(done({ role: 'reviewer' }), task, review([{ severity: 'suggestion' }]))).toBe(
      'Reviewed the change, 1 finding'
    );
    expect(
      resolveRunHeadline(
        done({ role: 'reviewer' }),
        task,
        review([{ severity: 'blocking' }, { severity: 'suggestion' }, { severity: 'blocking' }])
      )
    ).toBe('Reviewed the change, 3 findings (2 blocking)');
  });

  it('names what a fix is for from its prompt', () => {
    const cases: [string, string, string][] = [
      ['The checks failed after the last change:', 'Fixing the failing checks', 'Fixed the failing checks'],
      ['The agent review found problems.', 'Fixing the review findings', 'Fixed the review findings'],
      ['The human looked at the work and wrote:', 'Making your changes', 'Made your changes'],
      ['Pull request #12 needs work', 'Fixing the pull request', 'Fixed the pull request'],
    ];
    for (const [prompt, present, past] of cases) {
      expect(resolveRunHeadline(live({ role: 'fixer', prompt }), task, [])).toBe(present);
      expect(resolveRunHeadline(done({ role: 'shipper', prompt }), task, [])).toBe(past);
    }
  });

  it('falls back to the role when the fix prompt is unknown or missing', () => {
    expect(resolveRunHeadline(live({ role: 'fixer', prompt: 'Something else' }), task, [])).toBe(
      'Fixing the change'
    );
    expect(resolveRunHeadline(done({ role: 'fixer' }), task, [])).toBe('Fixed the change');
    expect(resolveRunHeadline(live({ role: 'shipper' }), task, [])).toBe('Fixing the pull request');
    expect(resolveRunHeadline(done({ role: 'shipper', prompt: 'Other' }), task, [])).toBe(
      'Fixed the pull request'
    );
  });
});
