import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { resolveStatusCard, resolveStatusLatest } from '@/lib/share/status.ts';
import { createRound } from '../../support/rounds.ts';
import { createTask } from '../../support/state.ts';

function report(headline: string) {
  return { headline, sections: [], checks: [], judgementCalls: [], walkthrough: null } as NonNullable<
    Task['report']
  >;
}

describe('the status card', () => {
  it('shows the title, the stage in its words and tone, and no description before a plan', () => {
    const card = resolveStatusCard(
      createTask({ id: 't', title: 'Fix export', request: 'Exports fail on Safari.', stage: 'building' })
    );
    expect(card).toEqual({
      title: 'Fix export',
      stage: { label: 'Building', tone: card.stage.tone },
      description: null,
      latest: null,
    });
  });

  it('describes the task by its plan’s goal', () => {
    const task = createTask({ id: 't' });
    const plan = {
      version: 1,
      body: '',
      document: { goal: 'Exports work on Safari.' },
    } as unknown as Task['plan'];
    expect(resolveStatusCard({ ...task, plan }).description).toBe('Exports work on Safari.');
  });

  it('takes the latest update from the report, the result, the summary, then the last round that had one', () => {
    const base = createTask({ id: 't' });
    expect(resolveStatusLatest({ ...base, report: report('Shipped the fix.') })).toBe('Shipped the fix.');
    expect(
      resolveStatusLatest({
        ...base,
        result: { step: 'answer', body: 'It is the cache.', runId: null, at: 1 },
      })
    ).toBe('It is the cache.');
    expect(resolveStatusLatest({ ...base, summary: 'Half way.' })).toBe('Half way.');
    const rounds = [
      createRound({ number: 1 }),
      createRound({ number: 2, outcome: { goal: null, phases: [], headline: null, result: 'Found it.' } }),
      createRound({ number: 3, outcome: null }),
    ];
    expect(resolveStatusLatest({ ...base, rounds })).toBe('Found it.');
    expect(resolveStatusLatest({ ...base, rounds: [createRound({ number: 1, outcome: null })] })).toBeNull();
  });
});
