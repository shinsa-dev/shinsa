import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import type { Gate, ShinsaState, Task } from '@shinsa/core';
import type { Command, CommandSection, MenuPage } from '@/lib/command/registry.ts';
import { listTaskPageSections, resolveTaskPage, type TaskPageContext } from '@/lib/command/task.ts';
import type { LineComment } from '@/lib/review/draft.ts';
import * as secrets from '@/lib/secrets.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createGate, createRun, createShinsaState, createTask } from '../../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const PULL_REQUEST = {
  number: 42,
  url: 'https://github.com/you/app/pull/42',
  state: 'open',
  checks: 'passing',
  unresolvedComments: 0,
  mergeable: true,
  updatedAt: 0,
} as unknown as NonNullable<Task['pullRequest']>;

const COMMENTS: LineComment[] = [
  {
    id: 'c1',
    path: 'src/a.ts',
    side: 'new',
    line: 3,
    endLine: null,
    ref: null,
    text: 'Rename this',
  },
  {
    id: 'c2',
    path: 'src/b.ts',
    side: 'new',
    line: 9,
    endLine: null,
    ref: null,
    text: 'Drop the log',
  },
];

function createContext(overrides: Partial<TaskPageContext> = {}): TaskPageContext {
  return {
    tab: 'overview',
    tabs: ['overview', 'code', 'chat'],
    applyTab: mock(() => {}),
    comments: [],
    clearComments: mock(() => {}),
    verdicts: {},
    ...overrides,
  };
}

function setup(task: Task, gates: Gate[] = [], others: Task[] = []) {
  const state = createShinsaState({ tasks: [task, ...others], gates });
  return { state, task: state.tasks[task.id] as Task };
}

function sections(state: ShinsaState, task: Task, context = createContext()) {
  return listTaskPageSections(state, task, context, null);
}

function section(all: CommandSection[], id: string) {
  return all.find((entry) => entry.id === id);
}

function labels(entry: CommandSection | undefined) {
  return entry?.commands.map((command) => command.label) ?? [];
}

function find(all: CommandSection[], id: string): Command {
  const command = all.flatMap((entry) => entry.commands).find((candidate) => candidate.id === id);
  if (!command) throw new Error(`No command ${id}`);
  return command;
}

function run(command: Command) {
  if (command.kind !== 'run') throw new Error(`${command.id} is not a run command`);
  command.run();
}

function pageOf(command: Command): MenuPage {
  if (command.kind !== 'page') throw new Error(`${command.id} is not a page`);
  return command.page;
}

function send(command: Command, text: string) {
  const page = pageOf(command);
  if (page.kind !== 'compose') throw new Error(`${command.id} does not compose`);
  return page.send(text);
}

function pick(command: Command, value: string) {
  if (command.kind !== 'choice') throw new Error(`${command.id} is not a choice`);
  command.pick(value);
}

function answered(gateId: string, decision: string, response: string | null, done: string) {
  return [{ type: 'gate.answer', gateId, decision, response }, done];
}

describe('the decision on a task page', () => {
  it('offers approving or revising the plan', async () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'plan' });
    const { state, task } = setup(createTask({ id: 't1', stage: 'awaiting_plan' }), [gate]);
    const all = sections(state, task);
    expect(section(all, 'task.decide')?.heading).toBe('Decide on this task');
    expect(labels(section(all, 'task.decide'))).toEqual(['Approve the plan', 'Revise the plan']);
    run(find(all, 'task.t1.gate.g1.approve'));
    await send(find(all, 'task.t1.gate.g1.revise'), 'Split it in two');
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'approve', null, 'Approved. Building now.'),
      answered('g1', 'revise', 'Split it in two', 'Sent back to the agent.'),
    ] as never);
  });

  it('says the operation runs next when you approve an operation task’s plan', () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'plan' });
    const task = createTask({ id: 't1', stage: 'awaiting_plan', pipeline: ['plan', 'operate'] });
    const { state } = setup(task, [gate]);
    run(find(sections(state, task), 'task.t1.gate.g1.approve'));
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'approve', null, 'Approved. Running the operation now.'),
    ] as never);
  });

  it('offers approving, reviewing and requesting changes on a review', async () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const { state, task } = setup(
      createTask({ id: 't1', worktreePath: '/tmp/t1', stage: 'awaiting_review' }),
      [gate]
    );
    const all = sections(state, task);
    expect(labels(section(all, 'task.decide'))).toEqual([
      'Approve the changes',
      'Review the changes',
      'Request changes',
    ]);
    const approve = find(all, 'task.t1.gate.g1.approve');
    expect(approve.disabled).toBeUndefined();
    expect(approve.hint).toBe('Opens the pull request');
    expect(find(all, 'task.t1.gate.g1.review')).toMatchObject({ kind: 'go', to: '/tasks/t1?tab=review' });
    run(approve);
    await send(find(all, 'task.t1.gate.g1.revise'), 'Handle the empty list');
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'approve', null, 'Approved. Opening the pull request.'),
      answered('g1', 'revise', 'Handle the empty list', 'Sent back to the agent.'),
    ] as never);
  });

  it('leaves out Review the changes on the Code tab and without a worktree', () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const onCode = setup(createTask({ id: 't1', worktreePath: '/tmp/t1' }), [gate]);
    expect(
      labels(section(sections(onCode.state, onCode.task, createContext({ tab: 'code' })), 'task.decide'))
    ).toEqual(['Approve the changes', 'Request changes']);
    const bare = setup(createTask({ id: 't1' }), [gate]);
    expect(labels(section(sections(bare.state, bare.task), 'task.decide'))).toEqual([
      'Approve the changes',
      'Request changes',
    ]);
  });

  it('disables Approve the changes while there are draft comments', () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const all = sections(state, task, createContext({ comments: COMMENTS }));
    const approve = find(all, 'task.t1.gate.g1.approve');
    expect(approve.disabled).toBe('Send or clear your comments first');
    expect(approve.hint).toBe('Opens the pull request');
    expect(find(all, 'task.t1.gate.g1.revise').label).toBe('Request changes with 2 comments');
    const one = sections(state, task, createContext({ comments: COMMENTS.slice(0, 1) }));
    expect(find(one, 'task.t1.gate.g1.revise').label).toBe('Request changes with 1 comment');
  });

  it('sends the draft comments with Request changes and then clears them', async () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const context = createContext({ comments: COMMENTS });
    await send(find(sections(state, task, context), 'task.t1.gate.g1.revise'), 'A few things');
    expect(spies.sent.mock.calls).toEqual([
      [
        {
          type: 'gate.answer',
          gateId: 'g1',
          decision: 'revise',
          response: 'A few things',
          comments: [
            { path: 'src/a.ts', side: 'new', line: 3, endLine: null, text: 'Rename this' },
            { path: 'src/b.ts', side: 'new', line: 9, endLine: null, text: 'Drop the log' },
          ],
        },
        'Sent back to the agent.',
      ],
    ] as never);
    expect(context.clearComments).toHaveBeenCalledTimes(1);
  });

  it('keeps the draft comments when Request changes fails to send', async () => {
    spies.sent.mockResolvedValue(false);
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const context = createContext({ comments: COMMENTS });
    expect(await send(find(sections(state, task, context), 'task.t1.gate.g1.revise'), 'A few things')).toBe(
      false
    );
    expect(context.clearComments).not.toHaveBeenCalled();
  });

  it('names the pull request it merges', () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'merge' });
    const withPr = setup(createTask({ id: 't1', pullRequest: PULL_REQUEST }), [gate]);
    const all = sections(withPr.state, withPr.task);
    expect(labels(section(all, 'task.decide'))).toEqual(['Merge #42', 'Request changes']);
    run(find(all, 'task.t1.gate.g1.merge'));
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'approve', null, 'Approved. Merging the pull request.'),
    ] as never);
    const without = setup(createTask({ id: 't1' }), [gate]);
    expect(find(sections(without.state, without.task), 'task.t1.gate.g1.merge').label).toBe(
      'Merge the pull request'
    );
  });

  it('answers an agent question', async () => {
    const gate = createGate({
      id: 'g1',
      taskId: 't1',
      type: 'question',
      title: 'Which database?',
    });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const answer = find(sections(state, task), 'task.t1.gate.g1.answer');
    expect(answer).toMatchObject({ label: 'Answer the question', hint: 'Which database?' });
    await send(answer, 'Postgres');
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'reply', 'Postgres', 'Answered. The agent carries on.'),
    ] as never);
  });

  it('sends a secret request to the task page, where the value is typed, and can decline it', () => {
    const gate = createGate({
      id: 'g1',
      taskId: 't1',
      type: 'secret',
      title: 'For the webhook.',
      secret: { label: 'GitHub secret' },
    });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const all = sections(state, task);
    expect(find(all, 'task.t1.gate.g1.secret')).toMatchObject({
      kind: 'go',
      label: 'Give the GitHub secret',
      hint: 'For the webhook.',
      to: '/tasks/t1',
    });
    expect(() => find(all, 'task.t1.gate.g1.answer')).toThrow();
    const decline = spyOn(secrets, 'declineSecret').mockResolvedValue(true);
    run(find(all, 'task.t1.gate.g1.secret.decline'));
    expect(decline).toHaveBeenCalledWith('g1');
    decline.mockRestore();
  });

  it('retries a paused task, with or without guidance', async () => {
    const gate = createGate({
      id: 'g1',
      taskId: 't1',
      type: 'failure',
      title: 'The checks failed',
    });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const all = sections(state, task);
    expect(labels(section(all, 'task.decide'))).toEqual(['Retry', 'Retry with guidance']);
    expect(find(all, 'task.t1.gate.g1.retry').hint).toBe('The checks failed');
    run(find(all, 'task.t1.gate.g1.retry'));
    await send(find(all, 'task.t1.gate.g1.guide'), 'Skip the flaky test');
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'approve', null, 'Picking it up again.'),
      answered('g1', 'reply', 'Skip the flaky test', 'Retrying with your guidance.'),
    ] as never);
  });

  it('puts a pause or a question before the decision it holds up', () => {
    const decision = createGate({ id: 'g1', taskId: 't1', type: 'review', openedAt: 1 });
    const failure = createGate({ id: 'g2', taskId: 't1', type: 'failure', openedAt: 2 });
    const { state, task } = setup(createTask({ id: 't1' }), [decision, failure]);
    expect(labels(section(sections(state, task), 'task.decide'))).toEqual([
      'Retry',
      'Retry with guidance',
      'Approve the changes',
      'Request changes',
    ]);
  });

  it('signs in again or retries anyway at a sign-in gate', () => {
    const signIn = createGate({ id: 'g1', taskId: 't1', type: 'sign_in' });
    const { state, task } = setup(createTask({ id: 't1' }), [signIn]);
    expect(labels(section(sections(state, task), 'task.decide'))).toEqual(['Sign in', 'Retry anyway']);
  });

  it('has no decision section without an open gate', () => {
    const answeredGate = createGate({ id: 'g1', taskId: 't1', status: 'answered' } as Partial<Gate> & {
      id: string;
      taskId: string;
    });
    const { state, task } = setup(createTask({ id: 't1' }), [answeredGate]);
    expect(section(sections(state, task), 'task.decide')).toBeUndefined();
  });

  it('answers any question gate the way it answers an agent’s', () => {
    const question = createGate({ id: 'g2', taskId: 't1', type: 'question' });
    const { state, task } = setup(createTask({ id: 't1' }), [question]);
    expect(labels(section(sections(state, task), 'task.decide'))).toEqual(['Answer the question']);
  });

  it('offers sending a pre-push hook failure to the agent again, and no way to push without the hook', () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'failure', cause: 'push_hook' });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const all = sections(state, task);
    expect(labels(section(all, 'task.decide'))).toEqual(['Send to the agent again', 'Retry with guidance']);
    run(find(all, 'task.t1.gate.g1.retry'));
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'approve', null, 'Sent to the agent again.'),
    ] as never);
  });

  it('offers the same retry on a paused budget as the card does', () => {
    const budget = createGate({
      id: 'g1',
      taskId: 't1',
      type: 'failure',
      cause: 'budget',
    });
    const { state, task } = setup(createTask({ id: 't1' }), [budget]);
    const spent = createRun({
      id: 'r1',
      taskId: 't1',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 6 },
    });
    const capped = {
      ...state,
      runs: { ...state.runs, r1: spent },
      settings: { ...state.settings, taskBudgetUsd: 5 },
    };
    expect(labels(section(sections(capped, task), 'task.decide'))).toEqual([
      'Allow another $5.00',
      'Retry with guidance',
    ]);
  });
});

describe('the view section', () => {
  it('switches tabs and marks the current one', () => {
    const { state, task } = setup(createTask({ id: 't1' }));
    const context = createContext({ tab: 'chat' });
    const all = sections(state, task, context);
    const view = section(all, 'task.view');
    expect(labels(view)).toEqual(['Overview', 'Code', 'Chat']);
    expect(view?.commands.map((command) => command.current)).toEqual([false, false, true]);
    run(find(all, 'task.t1.tab.code'));
    expect(context.applyTab).toHaveBeenCalledWith('code');
  });
});

describe('the This task section', () => {
  it('offers every action that applies to an open task with a pull request and a worktree', () => {
    const { state, task } = setup(
      createTask({ id: 't1', branch: 'feat/login', worktreePath: '/tmp/t1', pullRequest: PULL_REQUEST })
    );
    expect(labels(section(sections(state, task), 'task.actions'))).toEqual([
      'Set priority',
      'Message the agent',
      'Open the pull request on GitHub',
      'Copy branch name',
      'Open in editor',
      'Open a terminal',
      'Show in Finder',
      'Restart the current step',
      'Mark as done',
      'Cancel task',
    ]);
  });

  it('offers no way to change the kind of task: Shinsa decides it', () => {
    const { state, task } = setup(createTask({ id: 't1', stage: 'planning' }));
    expect(labels(section(sections(state, task), 'task.actions'))).not.toContain('Change the kind of task…');
  });

  it('offers resuming a usage wait and running on another account', () => {
    const waiting = createTask({
      id: 't1',
      usageWait: {
        id: 'w',
        runId: 'r',
        role: 'agent',
        phaseIndex: 0,
        account: null,
        resetAt: 2,
        armedAt: 1,
        autoResume: true,
        status: 'armed',
      },
    });
    const { state, task } = setup(waiting);
    const accounts = createSnapshot({ accounts: [createAccount({ id: 'a' })] });
    expect(
      labels(section(listTaskPageSections(state, task, createContext(), accounts), 'task.actions'))
    ).toEqual([
      'Resume now',
      'Don’t resume automatically',
      'Run on account…',
      'Set priority',
      'Message the agent',
      'Restart the current step',
      'Mark as done',
      'Cancel task',
    ]);
  });

  it('keeps only what still applies to a closed task', () => {
    const { state, task } = setup(
      createTask({ id: 't1', stage: 'done', closedAt: 1, branch: 'feat/login' }),
      [],
      [createTask({ id: 't2' })]
    );
    expect(labels(section(sections(state, task), 'task.actions'))).toEqual([
      'Set priority',
      'Copy branch name',
    ]);
  });

  it('sets the priority with a toast naming it', () => {
    const { state, task } = setup(createTask({ id: 't1', priority: 'high' }));
    const priority = find(sections(state, task), 'task.t1.priority');
    expect(priority).toMatchObject({ kind: 'choice', value: 'high', hint: 'High' });
    pick(priority, 'urgent');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.prioritize', taskId: 't1', priority: 'urgent' }, 'Priority set to urgent.'],
    ] as never);
  });

  it('messages the agent, saying what the message does where the task is', async () => {
    const { state, task } = setup(createTask({ id: 't1' }));
    const message = find(sections(state, task), 'task.t1.message');
    expect(message.kind === 'page' && message.page.kind === 'compose' && message.page.placeholder).toBe(
      'Tell the agent something. The step starts again with your message.'
    );
    await send(message, 'Use the new client');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.message', taskId: 't1', text: 'Use the new client' }, 'Sent. Restarting the step.'],
    ] as never);
  });

  it('turns a message at the operation gate into notes for the agent', async () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'operation' });
    const { state, task } = setup(createTask({ id: 't1', stage: 'awaiting_operation' }), [gate]);
    await send(find(sections(state, task), 'task.t1.message'), 'Wait for the deploy');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.message', taskId: 't1', text: 'Wait for the deploy' }, 'Notes saved.'],
    ] as never);
  });

  it('links to the pull request, copies the branch, opens the worktree and a terminal in it', () => {
    const { state, task } = setup(
      createTask({ id: 't1', branch: 'feat/login', worktreePath: '/tmp/t1', pullRequest: PULL_REQUEST })
    );
    const all = sections(state, task);
    expect(find(all, 'task.t1.pull-request')).toMatchObject({
      kind: 'link',
      href: PULL_REQUEST.url,
      hint: '#42',
    });
    expect(find(all, 'task.t1.branch').hint).toBe('feat/login');
    run(find(all, 'task.t1.branch'));
    run(find(all, 'task.t1.editor'));
    run(find(all, 'task.t1.terminal'));
    run(find(all, 'task.t1.finder'));
    expect(spies.copied.mock.calls).toEqual([['feat/login']] as never);
    expect(spies.opened.mock.calls).toEqual([
      ['t1', 'editor'],
      ['t1', 'finder'],
    ] as never);
    expect(spies.terminal).toHaveBeenCalledTimes(1);
  });

  it('restarts the step and marks the task done', () => {
    const { state, task } = setup(createTask({ id: 't1' }));
    const all = sections(state, task);
    run(find(all, 'task.t1.restart'));
    run(find(all, 'task.t1.complete'));
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.retry', taskId: 't1' }, 'Restarted.'],
      [{ type: 'task.complete', taskId: 't1' }, 'Marked done.'],
    ] as never);
  });

  it('cancels only after the confirm page, and Keep it sends nothing', () => {
    const { state, task } = setup(createTask({ id: 't1' }));
    const cancel = find(sections(state, task), 'task.t1.cancel');
    expect(cancel.destructive).toBe(true);
    const page = pageOf(cancel);
    if (page.kind !== 'list') throw new Error('Expected a confirm list');
    expect(page.placeholder).toBe('Cancel this task?');
    run(find(page.sections, 'task.t1.cancel.keep'));
    expect(spies.sent).not.toHaveBeenCalled();
    run(find(page.sections, 'task.t1.cancel.confirm'));
    expect(spies.sent.mock.calls).toEqual([[{ type: 'task.cancel', taskId: 't1' }, 'Cancelled.']] as never);
  });
});

describe('waiting on other tasks', () => {
  it('offers no dependency commands without another task or a dependency', () => {
    const { state, task } = setup(createTask({ id: 't1' }));
    expect(labels(section(sections(state, task), 'task.actions'))).not.toContain('Merge after another task…');
  });

  it('names the choice for where the task is', () => {
    const early = setup(createTask({ id: 't1', stage: 'waiting_on_tasks' }), [], [createTask({ id: 't2' })]);
    expect(find(sections(early.state, early.task), 'task.t1.dependency.wait').label).toBe(
      'Wait for another task…'
    );
    const late = setup(createTask({ id: 't1', stage: 'building' }), [], [createTask({ id: 't2' })]);
    expect(find(sections(late.state, late.task), 'task.t1.dependency.wait').label).toBe(
      'Merge after another task…'
    );
  });

  it('ticks every task it waits on, lists them first and names them in the hint', () => {
    const { state, task } = setup(
      createTask({ id: 't1', waitsOn: ['t3', 't2'] }),
      [],
      [
        createTask({ id: 't2', title: 'Add the API' }),
        createTask({ id: 't3', title: 'Write the schema' }),
        createTask({ id: 't4', title: 'Unrelated' }),
      ]
    );
    const all = sections(state, task);
    const wait = find(all, 'task.t1.dependency.wait');
    if (wait.kind !== 'choice') throw new Error('Expected a choice');
    expect(wait.value).toEqual(['t3', 't2']);
    expect(wait.hint).toBe('Write the schema, Add the API');
    expect(wait.options.map((option) => option.value)).toEqual(['t2', 't3', 't4']);
    expect(find(all, 'task.t1.dependency.clear')).toMatchObject({
      label: 'Stop waiting',
      hint: 'Write the schema, Add the API',
    });
  });

  it('toggles the task you pick and ignores one that no longer exists', () => {
    const { state, task } = setup(
      createTask({ id: 't1', waitsOn: ['t2'] }),
      [],
      [createTask({ id: 't2', title: 'Add the API' }), createTask({ id: 't3', title: 'Write the schema' })]
    );
    const wait = find(sections(state, task), 'task.t1.dependency.wait');
    pick(wait, 't2');
    pick(wait, 't3');
    pick(wait, 'gone');
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.wait_on', taskId: 't1', waitsOn: [] }, 'No longer waits on “Add the API”.'],
      [{ type: 'task.wait_on', taskId: 't1', waitsOn: ['t2', 't3'] }, 'Waits on “Write the schema”.'],
    ] as never);
  });

  it('stops waiting on everything', () => {
    const { state, task } = setup(
      createTask({ id: 't1', waitsOn: ['t2'] }),
      [],
      [createTask({ id: 't2', stage: 'merged' })]
    );
    const all = sections(state, task);
    expect(find(all, 'task.t1.dependency.clear').hint).toBeUndefined();
    run(find(all, 'task.t1.dependency.clear'));
    expect(spies.sent.mock.calls).toEqual([
      [{ type: 'task.wait_on', taskId: 't1', waitsOn: [] }, 'No longer waiting.'],
    ] as never);
  });

  it('offers nothing about waiting on a finished task', () => {
    const { state, task } = setup(
      createTask({ id: 't1', stage: 'done', waitsOn: ['t2'] }),
      [],
      [createTask({ id: 't2' })]
    );
    const ids = sections(state, task).flatMap((entry) => entry.commands.map((command) => command.id));
    expect(ids.filter((id) => id.includes('dependency'))).toEqual([]);
  });
});

describe('moving through Needs you', () => {
  function queueOf(ids: string[], current = createTask({ id: 'current' })) {
    const tasks = ids.map((id) => createTask({ id, title: `Task ${id}` }));
    const gates = ids.map((id, index) => createGate({ id: `g-${id}`, taskId: id, openedAt: index }));
    const state = createShinsaState({ tasks: [...tasks, current], gates });
    return { state, task: state.tasks[current.id] as Task };
  }

  it('steps to the next and previous task that needs you', () => {
    const { state, task } = queueOf(['a', 'b', 'c'], createTask({ id: 'b' }));
    const queue = section(sections(state, task), 'task.queue');
    expect(queue?.heading).toBe('Needs you');
    expect(queue?.commands).toMatchObject([
      { id: 'queue.next', label: 'Next task that needs you', hint: 'Task c', taskId: 'c', to: '/tasks/c' },
      {
        id: 'queue.previous',
        label: 'Previous task that needs you',
        hint: 'Task a',
        taskId: 'a',
        to: '/tasks/a',
      },
    ]);
  });

  it('only steps forward from the first task', () => {
    const { state, task } = queueOf(['a', 'b'], createTask({ id: 'a' }));
    expect(labels(section(sections(state, task), 'task.queue'))).toEqual(['Next task that needs you']);
  });

  it('leads into the queue from a task that is not in it', () => {
    const { state, task } = queueOf(['a', 'b']);
    expect(section(sections(state, task), 'task.queue')?.commands).toMatchObject([
      { id: 'queue.next', taskId: 'a' },
    ]);
  });

  it('has no Needs you section when nothing else needs you', () => {
    const { state, task } = queueOf([]);
    expect(section(sections(state, task), 'task.queue')).toBeUndefined();
  });
});

describe('resolveTaskPage', () => {
  it('opens a task from anywhere with its decision, tabs and actions', () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'review' });
    const { state, task } = setup(
      createTask({ id: 't1', title: 'Fix login', worktreePath: '/tmp/t1', stage: 'awaiting_review' }),
      [gate]
    );
    const page = resolveTaskPage(state, task, null);
    if (page.kind !== 'list') throw new Error('Expected a list page');
    expect(page.crumb).toBe('Fix login');
    expect(page.placeholder).toBe('Act on this task…');
    expect(page.sections.map((entry) => entry.id)).toEqual(['decide', 'open', 'task']);
    expect(labels(page.sections[0])).toEqual([
      'Approve the changes',
      'Review the changes',
      'Request changes',
    ]);
    expect(page.sections[1]?.commands).toMatchObject([
      { kind: 'go', label: 'Overview', to: '/tasks/t1' },
      { kind: 'go', label: 'Review', to: '/tasks/t1?tab=review' },
      { kind: 'go', label: 'Code', to: '/tasks/t1?tab=code' },
      { kind: 'go', label: 'Chat', to: '/tasks/t1?tab=chat' },
    ]);
    expect(labels(page.sections[2])).toContain('Cancel task');
  });

  it('offers what the task page offers while a task waits: check in now, resume, quiet agent, delegations', () => {
    const monitor = {
      id: 'm',
      runId: 'r',
      role: 'agent' as const,
      phaseIndex: 0,
      notes: 'The deploy.',
      armedAt: 0,
      nextCheckAt: Date.now() + 60_000,
      timeoutAt: Date.now() + 600_000,
      attempts: 0,
      maxAttempts: 3,
      status: 'armed' as const,
    };
    const usageWait = {
      id: 'w',
      runId: 'r',
      role: 'agent' as const,
      phaseIndex: 0,
      account: null,
      resetAt: Date.now() + 60_000,
      armedAt: 0,
      autoResume: true,
      status: 'armed' as const,
    };
    const task = createTask({ id: 't1', monitor, usageWait });
    const step = createRun({
      id: 'r',
      taskId: 't1',
      status: 'running',
      silence: { since: Date.now() - 10 * 60_000, snoozedUntil: null, dismissed: false },
    });
    const child = createRun({
      id: 'child',
      taskId: 't1',
      role: 'reviewer',
      status: 'running',
      delegation: {
        parentRunId: 'r',
        depth: 1,
        requestKey: 'k',
        title: 'Survey the tests',
        brief: 'b',
        mode: 'async',
        wake: 'always',
        isolation: 'shared',
        baseCommit: null,
        delivery: 'none',
        question: null,
        requestedAt: 0,
      },
    });
    const state = createShinsaState({ tasks: [task], runs: [step, child] });
    const page = resolveTaskPage(state, task, null);
    if (page.kind !== 'list') throw new Error('Expected a list page');
    expect(labels(page.sections.find((entry) => entry.id === 'task'))).toEqual(
      expect.arrayContaining([
        'Check in now',
        'Snooze the quiet-agent warning on the agent',
        'Stop “Survey the tests” and what it delegated',
        'Resume now',
      ])
    );
  });

  it('leaves out Decide when nothing waits on you', () => {
    const { state, task } = setup(createTask({ id: 't1', stage: 'triage' }));
    const page = resolveTaskPage(state, task, null);
    if (page.kind !== 'list') throw new Error('Expected a list page');
    expect(page.sections.map((entry) => entry.id)).toEqual(['open', 'task']);
    expect(labels(page.sections[0])).toEqual(['Overview', 'Chat']);
  });

  it('sends Request changes from another page without comments to clear', async () => {
    const gate = createGate({ id: 'g1', taskId: 't1', type: 'merge' });
    const { state, task } = setup(createTask({ id: 't1' }), [gate]);
    const page = resolveTaskPage(state, task, null);
    if (page.kind !== 'list') throw new Error('Expected a list page');
    await send(find(page.sections, 'task.t1.gate.g1.revise'), 'Rebase first');
    expect(spies.sent.mock.calls).toEqual([
      answered('g1', 'revise', 'Rebase first', 'Sent back to the agent.'),
    ] as never);
  });
});
