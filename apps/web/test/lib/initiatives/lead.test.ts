import { describe, expect, it } from 'bun:test';
import { resolveLeadView, selectLedInitiative } from '@/lib/initiatives/lead.ts';
import { createInitiative, createShinsaState, createTask, NOW } from '../../support/state.ts';

const SPLIT = createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' });

const LEAD = createTask({ id: 'lead', pipeline: ['lead'], stage: 'leading', initiativeId: 'split' });

const DOCK = createTask({ id: 'dock', initiativeId: 'split' });

describe('the task that leads an initiative', () => {
  it('is found only for the lead itself', () => {
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [LEAD, DOCK] });
    expect(selectLedInitiative(state, LEAD)?.id).toBe('split');
    expect(selectLedInitiative(state, DOCK)).toBeNull();
    expect(selectLedInitiative(state, createTask({ id: 'loose' }))).toBeNull();
    expect(selectLedInitiative(state, createTask({ id: 'gone', initiativeId: 'gone' }))).toBeNull();
  });
});

describe('the lead’s report', () => {
  it('is empty before its first report, and says whether the lead still runs', () => {
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [LEAD] });
    expect(resolveLeadView(state, SPLIT)).toEqual({ live: true, narrative: null, questions: [], at: null });
  });

  it('carries the last report once the lead has finished', () => {
    const report = { narrative: 'Dock in review.', questions: ['Merge first?'], runId: 'r', at: NOW };
    const done = { ...LEAD, stage: 'done' as const, closedAt: NOW };
    const state = createShinsaState({ initiatives: [{ ...SPLIT, report }], tasks: [done] });
    expect(resolveLeadView(state, { ...SPLIT, report })).toEqual({
      live: false,
      narrative: 'Dock in review.',
      questions: ['Merge first?'],
      at: NOW,
    });
  });
});
