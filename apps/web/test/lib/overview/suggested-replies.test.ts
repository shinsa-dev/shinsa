import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { listSuggestedReplies, sendSuggestedReply } from '@/lib/overview/suggested-replies.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createGate, createShinsaState, createTask } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const ACTION = { label: 'Do the renames', message: 'Do the renames too.' };

function reviewing(suggestedActions = [ACTION]) {
  const task = createTask({ id: 't', stage: 'awaiting_review', suggestedActions });
  const state = createShinsaState({
    tasks: [task],
    gates: [createGate({ id: 'g', taskId: 't', type: 'review' })],
  });
  return { state, task };
}

describe('suggested replies', () => {
  it('lists the agent’s suggestions while a message can reach it', () => {
    const { state, task } = reviewing();
    expect(listSuggestedReplies(state, task)).toEqual([ACTION]);
  });

  it('lists none when the agent suggested none', () => {
    const { state, task } = reviewing([]);
    expect(listSuggestedReplies(state, createTask({ ...task, suggestedActions: undefined }))).toEqual([]);
    expect(listSuggestedReplies(state, task)).toEqual([]);
  });

  it('lists none and sends nothing once the task takes no messages', async () => {
    const task = createTask({ id: 't', stage: 'cancelled', suggestedActions: [ACTION] });
    const state = createShinsaState({ tasks: [task] });
    expect(listSuggestedReplies(state, task)).toEqual([]);
    expect(await sendSuggestedReply(state, task, ACTION)).toBe(false);
    expect(spies.sent).not.toHaveBeenCalled();
  });

  it('sends the suggestion’s message as the human’s own, worded for the gate it answers', async () => {
    const { state, task } = reviewing();
    expect(await sendSuggestedReply(state, task, ACTION)).toBe(true);
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'task.message', taskId: 't', text: 'Do the renames too.' },
      'Changes requested.'
    );
  });
});
