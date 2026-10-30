import { describe, expect, it } from 'bun:test';
import {
  describeMessageStatus,
  isDelivering,
  resolveMessageHint,
  sendTaskMessage,
} from '@/lib/tasks/messages.ts';
import { listOutboxMessages } from '@/lib/tasks/outbox.ts';
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
    const gate = (type: 'operation' | 'proposal' | 'failure' | 'sign_in') =>
      createGate({ id: 'g', taskId: 't', type });
    expect(hintFor({ id: 't', stage: 'awaiting_plan' })).toBe(
      'Say what to change in the plan. The agent revises it and asks you again.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_review' })).toBe(
      'Ask for changes. The agent makes them and the review comes back to you.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_merge' })).toBe(
      'Ask for a change before the merge. The agent makes it and the merge comes back to you.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_operation' }, { gates: [gate('operation')] })).toBe(
      'Write the notes for the agent. They replace the saved notes and go with the operation.'
    );
    expect(hintFor({ id: 't', stage: 'awaiting_proposal' }, { gates: [gate('proposal')] })).toBe(
      'Reply instead of deciding. The proposal is declined and the agent carries on with your message.'
    );
    expect(hintFor({ id: 't', stage: 'building' }, { gates: [gate('failure')] })).toBe(
      'Say what to do differently. The step starts again with your message.'
    );
    expect(hintFor({ id: 't', stage: 'building' }, { gates: [gate('sign_in')] })).toBe(
      'Say what to do differently. The step starts again with your message.'
    );
  });

  it('says a message at the setup gate verifies the setup again and goes to the first agent', () => {
    const setup = createGate({ id: 'g', taskId: 't', type: 'configuration' });
    expect(hintFor({ id: 't', stage: 'triage' }, { gates: [setup] })).toBe(
      'Tell the agent something. The setup is verified again and the first agent reads it.'
    );
  });

  it('says a message reaches a working agent, takes a follow-up or more work on a merged task, and a closed task takes none', () => {
    const run = createRun({ id: 'r', taskId: 't', status: 'running' });
    expect(hintFor({ id: 't', stage: 'building' }, { runs: [run] })).toBe(
      'Tell the agent something. It reaches the agent while it works.'
    );
    expect(hintFor({ id: 't', stage: 'merged' })).toBe('Ask a follow-up, or for more work.');
    expect(hintFor({ id: 't', stage: 'done', closedAt: 1 })).toBeNull();
  });
});

describe('sendTaskMessage', () => {
  it('sends the message to the task and toasts what it does there', async () => {
    const commands = spyOnCommands();
    const task = createTask({ id: 't', stage: 'awaiting_review' });
    const hint = resolveMessageHint(createShinsaState({ tasks: [task] }), task);
    if (!hint) throw new Error('The task takes no message.');
    const sending = sendTaskMessage(task, hint, 'Rename the button.');
    expect(listOutboxMessages('t').map((message) => message.text)).toEqual(['Rename the button.']);
    expect(await sending).toBe(true);
    expect(listOutboxMessages('t')).toEqual([]);
    expect(commands.sent).toHaveBeenCalledWith(
      { type: 'task.message', taskId: 't', text: 'Rename the button.' },
      'Changes requested.'
    );
    commands.restore();
  });

  it('toasts that a message at the setup gate verifies the setup again', async () => {
    const commands = spyOnCommands();
    const task = createTask({ id: 't', stage: 'triage' });
    const setup = createGate({ id: 'g', taskId: 't', type: 'configuration' });
    const hint = resolveMessageHint(createShinsaState({ tasks: [task], gates: [setup] }), task);
    if (!hint) throw new Error('The task takes no message.');
    await sendTaskMessage(task, hint, 'Use bun test for the checks.');
    expect(commands.sent).toHaveBeenCalledWith(
      { type: 'task.message', taskId: 't', text: 'Use bun test for the checks.' },
      'Verifying the setup again.'
    );
    commands.restore();
  });
});

describe('isDelivering', () => {
  it('is true only while the message is on its way into the task', () => {
    expect(isDelivering({ status: 'delivering' })).toBe(true);
    expect(isDelivering({})).toBe(false);
    expect(isDelivering({ status: 'noted' })).toBe(false);
  });
});

describe('describeMessageStatus', () => {
  it('words only the end states: a delivered or delivering message has no line', () => {
    expect(describeMessageStatus({})).toBeNull();
    expect(describeMessageStatus({ status: 'delivering' })).toBeNull();
    expect(describeMessageStatus({ status: 'noted' })).toEqual({
      text: 'Noted. It needs no reply.',
      tone: 'quiet',
    });
    expect(
      describeMessageStatus({ status: 'undelivered', reason: 'This task is finished. Start a new one.' })
    ).toEqual({ text: 'Not delivered. This task is finished. Start a new one.', tone: 'refused' });
    expect(describeMessageStatus({ status: 'undelivered' })).toEqual({
      text: 'Not delivered.',
      tone: 'refused',
    });
  });

  it('says where a message read as another task’s work went, and what became of it', () => {
    expect(describeMessageStatus({ status: 'split_off' })).toEqual({
      text: 'Not sent to the agent: it reads as work for another task. Make it a task or keep it here under Suggested tasks on the Overview.',
      tone: 'notice',
    });
    expect(describeMessageStatus({ status: 'made_task' })).toEqual({
      text: 'Made into a task of its own.',
      tone: 'quiet',
    });
    expect(describeMessageStatus({ status: 'split_off_dismissed' })).toEqual({
      text: 'Suggested as a separate task, then dismissed.',
      tone: 'quiet',
    });
  });
});
