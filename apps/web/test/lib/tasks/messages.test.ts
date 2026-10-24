import { describe, expect, it } from 'bun:test';
import { resolveMessageHint, sendTaskMessage } from '@/lib/tasks/messages.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

function hintFor(
  task: Parameters<typeof createTask>[0],
  parts: Parameters<typeof createShinsaState>[0] = {}
) {
  const subject = createTask(task);
  const state = createShinsaState({ ...parts, tasks: [subject] });
  return resolveMessageHint(state, state.tasks[subject.id] as typeof subject)?.placeholder ?? null;
}

describe('resolveMessageHint', () => {
  it('says what a message does at each gate a person answers', () => {
    const gate = (purpose: 'operation' | 'change' | 'failure') =>
      createGate({ id: 'g', taskId: 't', kind: 'question', purpose });
    expect(hintFor({ id: 't', stage: 'awaiting_plan' })).toBe(
      'Say what to change in the plan. The planner revises it and asks you again.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_review' })).toBe(
      'Ask for changes. A fixer makes them and the review comes back to you.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_merge' })).toBe(
      'Ask for a change before the merge. A fixer makes it and the merge comes back to you.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_operation' }, { gates: [gate('operation')] })).toBe(
      'Add notes for the operator. They go with the operation once you run it.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_proposal' }, { gates: [gate('change')] })).toBe(
      'Reply instead of deciding. The proposal is declined and the agent carries on with your message.'
    );
    expect(hintFor({ id: 't', stage: 'building' }, { gates: [gate('failure')] })).toBe(
      'Say what to do differently. The step starts again with your message.'
    );
  });

  it('says a message reaches a working agent, starts a new round of a merged task, and a closed task takes none', () => {
    const run = createRun({ id: 'r', taskId: 't', status: 'running' });
    expect(hintFor({ id: 't', stage: 'building' }, { runs: [run] })).toBe(
      'Tell the agent something. It reaches the agent while it works.'
    );
    expect(hintFor({ id: 't', stage: 'merged' })).toBe(
      'Ask for the next piece of work. It starts as a new round of this task.'
    );
    expect(hintFor({ id: 't', stage: 'done', closedAt: 1 })).toBeNull();
  });
});

describe('sendTaskMessage', () => {
  it('sends the message to the task and toasts what it does there', async () => {
    const commands = spyOnCommands();
    const task = createTask({ id: 't', stage: 'awaiting_review' });
    const hint = resolveMessageHint(createShinsaState({ tasks: [task] }), task);
    if (!hint) throw new Error('The task takes no message.');
    expect(await sendTaskMessage(task, hint, 'Rename the button.')).toBe(true);
    expect(commands.sent).toHaveBeenCalledWith(
      { type: 'task.message', taskId: 't', text: 'Rename the button.' },
      'Changes requested. A fixer is on it.'
    );
    commands.restore();
  });
});
