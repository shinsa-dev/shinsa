import { describe, expect, it } from 'bun:test';
import {
  adoptTask,
  changeTaskPhase,
  describeTaskInitiative,
  focusInitiative,
  joinInitiative,
  leaveInitiative,
  listInitiativeChoices,
  removeInitiative,
  selectTaskInitiative,
} from '@/lib/initiatives/membership.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';

const SPLIT = createInitiative({ id: 'split', name: 'Chat split', phases: [{ id: 'p1', name: 'Dock' }] });

const BILLING = createInitiative({ id: 'billing', name: 'Billing' });

describe('a task’s initiative', () => {
  const state = createShinsaState({ initiatives: [SPLIT, BILLING] });

  it('names the initiative with the phase, or alone, or nothing outside one', () => {
    const phased = createTask({ id: 't', initiativeId: 'split', initiativePhaseId: 'p1' });
    expect(describeTaskInitiative(state, phased)?.label).toBe('Chat split · Dock');
    const loose = createTask({ id: 't', initiativeId: 'billing' });
    expect(describeTaskInitiative(state, loose)?.label).toBe('Billing');
    expect(describeTaskInitiative(state, createTask({ id: 't' }))).toBeNull();
    expect(selectTaskInitiative(state, createTask({ id: 't', initiativeId: 'gone' }))).toBeNull();
  });

  it('offers every initiative but the one the task is in', () => {
    const member = createTask({ id: 't', initiativeId: 'split' });
    expect(listInitiativeChoices(state, member).map((each) => each.id)).toEqual(['billing']);
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

  it('makes an initiative from a task, focuses on one and removes one', async () => {
    const spies = spyOnCommands();
    await adoptTask(task);
    await focusInitiative(SPLIT);
    await removeInitiative(SPLIT);
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'initiative.adopt_task', taskId: 't' }, 'Made an initiative from this task.'],
      [
        { type: 'focus.change', projectId: null, teamId: null, initiativeId: 'split', until: null },
        'Focused on “Chat split”.',
      ],
      [{ type: 'initiative.remove', initiativeId: 'split' }, 'Removed “Chat split”.'],
    ]);
  });
});
