import { describe, expect, it } from 'bun:test';
import {
  adoptTask,
  changeTaskPhase,
  describeTaskInitiative,
  focusInitiative,
  joinInitiative,
  leaveInitiative,
  listInitiativeChoices,
  listOpenInitiatives,
  selectTaskInitiative,
} from '@/lib/initiatives/membership.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';

const SPLIT = createInitiative({
  id: 'split',
  name: 'Chat split',
  phases: [{ id: 'p1', name: 'Dock' }],
  leadTaskId: 'lead-split',
});

const BILLING = createInitiative({ id: 'billing', name: 'Billing', leadTaskId: 'lead-billing' });

const DOCS = createInitiative({ id: 'docs', name: 'Docs', leadTaskId: 'lead-docs' });

const LEADS = [
  createTask({ id: 'lead-split', pipeline: ['lead'], stage: 'leading', initiativeId: 'split' }),
  createTask({ id: 'lead-billing', pipeline: ['lead'], stage: 'leading', initiativeId: 'billing' }),
  createTask({ id: 'lead-docs', pipeline: ['lead'], stage: 'done', initiativeId: 'docs' }),
];

describe('a task’s initiative', () => {
  const state = createShinsaState({ initiatives: [SPLIT, BILLING, DOCS], tasks: LEADS });

  it('names the initiative with the phase, or alone, or nothing outside one', () => {
    const phased = createTask({ id: 't', initiativeId: 'split', initiativePhaseId: 'p1' });
    expect(describeTaskInitiative(state, phased)?.label).toBe('Chat split · Dock');
    const loose = createTask({ id: 't', initiativeId: 'billing' });
    expect(describeTaskInitiative(state, loose)?.label).toBe('Billing');
    expect(describeTaskInitiative(state, createTask({ id: 't' }))).toBeNull();
    expect(selectTaskInitiative(state, createTask({ id: 't', initiativeId: 'gone' }))).toBeNull();
  });

  it('offers every open initiative but the one the task is in, and none to a lead', () => {
    const member = createTask({ id: 't', initiativeId: 'split' });
    expect(listOpenInitiatives(state).map((each) => each.id)).toEqual(['billing', 'split']);
    expect(listInitiativeChoices(state, member).map((each) => each.id)).toEqual(['billing']);
    expect(listInitiativeChoices(state, LEADS[0] ?? member)).toEqual([]);
  });
});

describe('initiative commands', () => {
  const task = createTask({ id: 't' });

  it('joins, moves between phases and leaves with a toast naming each', async () => {
    const spies = spyOnCommands();
    await joinInitiative(task, SPLIT);
    await changeTaskPhase(task, SPLIT, 'p1');
    await changeTaskPhase(task, SPLIT, null);
    await leaveInitiative(task, SPLIT);
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: null },
        'Added to the initiative “Chat split”.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: 'p1' },
        'Moved to the phase “Dock”.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: 'split', phaseId: null },
        'Taken out of its phase.',
      ],
      [
        { type: 'task.join_initiative', taskId: 't', initiativeId: null, phaseId: null },
        'Taken out of “Chat split”.',
      ],
    ]);
  });

  it('makes an initiative from a task and focuses on one', async () => {
    const spies = spyOnCommands();
    await adoptTask(task);
    await focusInitiative(SPLIT);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'initiative.adopt_task', taskId: 't' }, 'Made an initiative from this task.'],
      [
        { type: 'focus.change', projectId: null, teamId: null, initiativeId: 'split', until: null },
        'Focused on “Chat split”.',
      ],
    ]);
  });
});
