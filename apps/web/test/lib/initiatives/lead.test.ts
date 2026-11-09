import { describe, expect, it } from 'bun:test';
import { selectLedInitiative } from '@/lib/initiatives/lead.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';

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
