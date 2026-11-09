import { describe, expect, it } from 'bun:test';
import {
  canLeadFromTask,
  FRESH_LEAD,
  listLeadSources,
  selectLeadView,
  startLead,
} from '@/lib/initiatives/lead.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';

const LEAD = createTask({
  id: 'lead',
  title: 'Lead the chat split',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

const DOCK = createTask({ id: 'dock', handle: 'SW-101', title: 'Rewrite the dock', initiativeId: 'split' });

const STUDIO = createTask({ id: 'studio', title: 'Add the studio chat', initiativeId: 'split' });

const SPLIT = createInitiative({ id: 'split', name: 'Chat split' });

describe('the lead of an initiative', () => {
  it('is null without a live lead', () => {
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [DOCK] });
    expect(selectLeadView(state, SPLIT)).toBeNull();
    const finished = { ...LEAD, stage: 'done' as const };
    const led = { ...SPLIT, leadTaskId: 'lead' };
    expect(selectLeadView(createShinsaState({ initiatives: [led], tasks: [finished] }), led)).toBeNull();
  });

  it('carries the lead and its last report, or none before its first', () => {
    const led = { ...SPLIT, leadTaskId: 'lead' };
    const state = createShinsaState({ initiatives: [led], tasks: [LEAD] });
    expect(selectLeadView(state, led)).toEqual({ lead: LEAD, narrative: null, questions: [], at: null });
    const reported = {
      ...led,
      report: { narrative: 'The dock is in review.', questions: ['Ship it first?'], runId: 'r', at: 5 },
    };
    expect(selectLeadView(state, reported)).toEqual({
      lead: LEAD,
      narrative: 'The dock is in review.',
      questions: ['Ship it first?'],
      at: 5,
    });
  });

  it('starts fresh or from any of the initiative’s tasks, never from a lead', () => {
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [DOCK, STUDIO, LEAD] });
    expect(listLeadSources(state, SPLIT)).toEqual([
      { value: FRESH_LEAD, label: 'A new conversation' },
      { value: 'dock', label: 'Rewrite the dock', hint: 'SW-101' },
      { value: 'studio', label: 'Add the studio chat' },
    ]);
  });

  it('offers a member’s chat as the lead only while the initiative has no live one', () => {
    const state = createShinsaState({ initiatives: [SPLIT], tasks: [DOCK, LEAD] });
    expect(canLeadFromTask(state, DOCK)?.id).toBe('split');
    expect(canLeadFromTask(state, LEAD)).toBeNull();
    expect(canLeadFromTask(state, createTask({ id: 'loose' }))).toBeNull();
    expect(canLeadFromTask(state, createTask({ id: 'orphan', initiativeId: 'gone' }))).toBeNull();
    const led = createShinsaState({ initiatives: [{ ...SPLIT, leadTaskId: 'lead' }], tasks: [DOCK, LEAD] });
    expect(canLeadFromTask(led, DOCK)).toBeNull();
  });

  it('starts a lead fresh or forked, naming the initiative', async () => {
    const spies = spyOnCommands();
    await startLead(SPLIT, FRESH_LEAD);
    await startLead(SPLIT, 'dock');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'initiative.start_lead', initiativeId: 'split', forkOf: null },
        'Started a lead for “Chat split”.',
      ],
      [
        { type: 'initiative.start_lead', initiativeId: 'split', forkOf: 'dock' },
        'Started a lead for “Chat split”.',
      ],
    ]);
  });
});
