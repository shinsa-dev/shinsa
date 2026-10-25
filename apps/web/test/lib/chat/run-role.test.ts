import { describe, expect, it } from 'bun:test';
import { type PlanDocument, type Run, resolveHouseRules, type Task } from '@shinsa/core';
import { RUN_ROLE, resolveRunHeadline } from '@/lib/chat/run-role.ts';
import { createCallEntry, shinsaTool } from '../../support/chat.ts';
import { createRun, createTask, NOW } from '../../support/state.ts';

function document(titles: string[]): PlanDocument {
  return {
    goal: 'Goal',
    phases: titles.map((title) => ({ title, detail: `${title} detail` })),
    behaviour: [],
    approach: '',
    files: [],
    outOfScope: [],
    verification: [],
    questions: [],
  };
}

function withPlan(titles: string[]): Task {
  return createTask({ id: 't', plan: { version: 1, body: '', document: document(titles), proposedAt: NOW } });
}

const task = createTask({ id: 't' });

function resolveAgentPrompt(instruction: string) {
  return `${resolveHouseRules('agent')}\n\n${instruction}`;
}

function live(overrides: Partial<Run>) {
  return createRun({ id: 'r', taskId: 't', ...overrides });
}

function done(overrides: Partial<Run>) {
  return createRun({ id: 'r', taskId: 't', endedAt: NOW, outcome: 'completed', ...overrides });
}

describe('RUN_ROLE', () => {
  it('names each role in plain words with one icon', () => {
    expect(Object.fromEntries(Object.entries(RUN_ROLE).map(([role, mark]) => [role, mark.name]))).toEqual({
      agent: 'Agent',
      planner: 'Planner',
      builder: 'Builder',
      reviewer: 'Reviewer',
      answerer: 'Answerer',
      investigator: 'Investigator',
      researcher: 'Researcher',
    });
    expect(RUN_ROLE.agent.icon).toBe('IconAgent');
  });
});

describe('resolveRunHeadline', () => {
  it('describes an answerer while it works and once it answered', () => {
    expect(resolveRunHeadline(live({ role: 'answerer' }), task, [])).toBe('Answering your question');
    expect(resolveRunHeadline(done({ role: 'answerer' }), task, [])).toBe('Answered your question');
  });

  it('describes an investigation and research while they work and once they hand over', () => {
    expect(resolveRunHeadline(live({ role: 'investigator' }), task, [])).toBe('Investigating');
    expect(resolveRunHeadline(done({ role: 'investigator' }), task, [])).toBe('Reported the diagnosis');
    expect(resolveRunHeadline(live({ role: 'researcher' }), task, [])).toBe('Researching');
    expect(resolveRunHeadline(done({ role: 'researcher' }), task, [])).toBe('Wrote the report');
  });

  it('describes the agent running the operation and once it reported the outcome', () => {
    expect(resolveRunHeadline(live({ role: 'agent', purpose: 'operate' }), task, [])).toBe(
      'Running the operation'
    );
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'operate' }), task, [])).toBe(
      'Reported the outcome'
    );
  });

  it('keeps the present tense for a run that failed or was stopped', () => {
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'build', outcome: 'failed' }), task, [])).toBe(
      'Building the change'
    );
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'plan', outcome: 'cancelled' }), task, [])).toBe(
      'Planning the work'
    );
  });

  it('counts the phases of the plan the agent proposed last', () => {
    const entries = [
      createCallEntry('1', shinsaTool('propose_plan', { phases: [{ title: 'a' }] }), 1),
      createCallEntry(
        '2',
        shinsaTool('propose_plan', { phases: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] }),
        2
      ),
    ];
    expect(resolveRunHeadline(live({ role: 'agent', purpose: 'plan' }), task, entries)).toBe(
      'Planning the work'
    );
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'plan' }), task, entries)).toBe(
      'Planned 3 phases'
    );
  });

  it('falls back to the plan on the task, then to a plain headline', () => {
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'plan' }), withPlan(['Only']), [])).toBe(
      'Planned 1 phase'
    );
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'plan' }), task, [])).toBe('Planned the work');
  });

  it('names the phase the agent builds', () => {
    const planned = withPlan(['Add the form', 'Wire the API']);
    expect(resolveRunHeadline(live({ role: 'agent', purpose: 'build', phaseIndex: 1 }), planned, [])).toBe(
      'Phase 2 of 2: Wire the API'
    );
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'build', phaseIndex: 0 }), planned, [])).toBe(
      'Phase 1 of 2: Add the form'
    );
  });

  it('describes a build without a phase in the plan as building the change', () => {
    const planned = withPlan(['Add the form']);
    expect(resolveRunHeadline(live({ role: 'agent', purpose: 'build' }), planned, [])).toBe(
      'Building the change'
    );
    expect(resolveRunHeadline(done({ role: 'agent', phaseIndex: null }), task, [])).toBe('Built the change');
    expect(resolveRunHeadline(live({ role: 'agent', purpose: 'build', phaseIndex: 4 }), planned, [])).toBe(
      'Building the change'
    );
  });

  it('describes a delegated planner and builder by their role, not by the round', () => {
    const planned = withPlan(['Add the form']);
    expect(resolveRunHeadline(live({ role: 'planner' }), planned, [])).toBe('Planning the work');
    expect(resolveRunHeadline(done({ role: 'planner' }), planned, [])).toBe('Planned the work');
    expect(resolveRunHeadline(live({ role: 'builder', phaseIndex: 0 }), planned, [])).toBe(
      'Building the change'
    );
    expect(resolveRunHeadline(done({ role: 'builder' }), planned, [])).toBe('Built the change');
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

  it('names what a fix is for from the first words of its instruction, after the house rules', () => {
    const cases: [string, string, string][] = [
      ['The checks failed after the last change:', 'Fixing the failing checks', 'Fixed the failing checks'],
      ['The agent review found problems.', 'Fixing the review findings', 'Fixed the review findings'],
      ['The human looked at the work and wrote:', 'Making your changes', 'Made your changes'],
      ['Pull request #12 needs work', 'Fixing the pull request', 'Fixed the pull request'],
      ['GitButler left commits on your branch', 'Resolving conflicts', 'Resolved conflicts'],
      ['Your pull request conflicted with its base', 'Resolving conflicts', 'Resolved conflicts'],
    ];
    for (const [instruction, present, past] of cases) {
      const prompt = resolveAgentPrompt(instruction);
      expect(resolveRunHeadline(live({ role: 'agent', purpose: 'fix', prompt }), task, [])).toBe(present);
      expect(resolveRunHeadline(done({ role: 'agent', purpose: 'fix', prompt }), task, [])).toBe(past);
    }
  });

  it('reads the short instruction of a fix that carries the round brief', () => {
    const run = live({
      role: 'agent',
      purpose: 'fix',
      prompt: resolveAgentPrompt('Your conversation may no longer hold this round.\n\nThe checks failed:'),
      rolePrompt: resolveAgentPrompt('The checks failed after the last change:'),
    });
    expect(resolveRunHeadline(run, task, [])).toBe('Fixing the failing checks');
  });

  it('falls back to fixing the change when the fix instruction is unknown or missing', () => {
    expect(
      resolveRunHeadline(live({ role: 'agent', purpose: 'fix', prompt: 'Something else' }), task, [])
    ).toBe('Fixing the change');
    expect(resolveRunHeadline(done({ role: 'agent', purpose: 'fix' }), task, [])).toBe('Fixed the change');
  });
});
