import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import type { ChatEntry, Run, ShinsaState, Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { ChatTab } from '@/routes/task/chat.tsx';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createRound } from '../../support/rounds.ts';
import {
  createEntry,
  listSentCommands,
  pushAccounts,
  pushState,
  pushTranscript,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createRun, createShinsaState, createTask, NOW } from '../../support/state.ts';

const STARTED = NOW - 300_000;

function at(seconds: number) {
  return STARTED + seconds * 1000;
}

function finishedRun(overrides: Partial<Run> = {}) {
  return createRun({
    id: 'run-1',
    taskId: 'task-1',
    startedAt: STARTED,
    endedAt: at(180),
    outcome: 'completed',
    ...overrides,
  });
}

function workEntries(prefix = ''): ChatEntry[] {
  return [
    createEntry(
      { type: 'user', from: 'shinsa', text: 'Build the login form.', attachments: [] },
      `${prefix}brief`,
      at(0)
    ),
    createEntry(
      { type: 'agent', phase: 'interim', text: 'Looking around the code first.' },
      `${prefix}a1`,
      at(5)
    ),
    createEntry(
      { type: 'tool_call', callId: `${prefix}c1`, tool: { kind: 'read', path: 'src/login.ts', range: null } },
      `${prefix}t1`,
      at(10)
    ),
    createEntry(
      { type: 'tool_result', callId: `${prefix}c1`, status: 'ok', output: 'export {}', images: [] },
      `${prefix}r1`,
      at(11)
    ),
    createEntry(
      { type: 'tool_call', callId: `${prefix}c2`, tool: { kind: 'read', path: 'src/form.ts', range: null } },
      `${prefix}t2`,
      at(12)
    ),
    ...['bun test', 'bun lint', 'bun check-types'].flatMap((command, index) => [
      createEntry(
        {
          type: 'tool_call',
          callId: `${prefix}k${index}`,
          tool: { kind: 'command', action: 'run', command, description: null },
        },
        `${prefix}k${index}`,
        at(20 + index * 10)
      ),
      createEntry(
        { type: 'tool_result', callId: `${prefix}k${index}`, status: 'ok', output: 'ok', images: [] },
        `${prefix}kr${index}`,
        at(25 + index * 10)
      ),
    ]),
    createEntry(
      {
        type: 'tool_call',
        callId: `${prefix}h1`,
        tool: { kind: 'shinsa', name: 'complete_phase', args: { summary: 'The form validates input.' } },
      },
      `${prefix}h1`,
      at(60)
    ),
    createEntry(
      { type: 'tool_result', callId: `${prefix}h1`, status: 'ok', output: 'Recorded.', images: [] },
      `${prefix}hr1`,
      at(61)
    ),
    createEntry(
      { type: 'agent', phase: 'final', text: 'The login form is done.' },
      `${prefix}final`,
      at(170)
    ),
  ];
}

function renderChat(state: ShinsaState, task: Task, focusRunId: string | null = null) {
  pushState(state);
  return render(
    <TooltipProvider>
      <ChatTab state={state} task={task} focusRunId={focusRunId} />
    </TooltipProvider>
  );
}

beforeEach(() => {
  startFakeServer();
  setSystemTime(new Date(NOW));
});

afterEach(() => {
  stopFakeServer();
  setSystemTime();
});

describe('ChatTab', () => {
  it('folds a finished run into one worked row with the final reply under it', () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', workEntries());
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    const row = view.getByRole('button', { name: /Worked for/ });
    expect(row.textContent).toBe('Worked for 3m · 6 steps');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(view.getByText('The login form is done.')).toBeTruthy();
    expect(view.queryByText('Looking around the code first.')).toBeNull();
    expect(view.queryByText(/Read 2 files/)).toBeNull();
  });

  it('opens the fold onto the interim messages and the tool rows', () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', workEntries());
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    fireEvent.click(view.getByRole('button', { name: /Worked for/ }));
    expect(view.getByText('Looking around the code first.')).toBeTruthy();
    expect(view.getByText('Brief from Shinsa')).toBeTruthy();
    const group = view.getByRole('button', { name: 'Read 2 files and ran 3 commands' });
    expect(group.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(group);
    expect(view.getByText('src/login.ts')).toBeTruthy();
    expect(view.getByText('src/form.ts')).toBeTruthy();
    expect(view.getByText('bun check-types')).toBeTruthy();
  });

  it('keeps the hand-over card outside the fold', () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', workEntries());
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    expect(view.getByText('Handed over the phase')).toBeTruthy();
    expect(view.getByText('The form validates input.')).toBeTruthy();
  });

  it('shows a plan, a fix, a review and a question as cards outside the fold', () => {
    const task = createTask({ id: 'task-1' });
    const calls = [
      {
        name: 'propose_plan',
        args: { goal: 'Ship the form.', plan: [{ title: 'Add fields', detail: 'Two' }] },
      },
      { name: 'complete_fix', args: { summary: 'Fixed the null check.' } },
      {
        name: 'report_review',
        args: { findings: [{ severity: 'blocking', message: 'Missing test.', file: 'src/a.ts', line: 3 }] },
      },
      { name: 'ask', args: { question: 'Which colour?' } },
    ] as const;
    pushTranscript(
      'run-1',
      calls.flatMap((call, index) => [
        createEntry(
          {
            type: 'tool_call',
            callId: `h${index}`,
            tool: { kind: 'shinsa', name: call.name, args: call.args },
          },
          `h${index}`,
          at(10 + index * 10)
        ),
        createEntry(
          { type: 'tool_result', callId: `h${index}`, status: 'ok', output: 'Blue', images: [] },
          `hr${index}`,
          at(11 + index * 10)
        ),
      ])
    );
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    expect(view.getByText('Proposed the plan')).toBeTruthy();
    expect(view.getByText('Add fields')).toBeTruthy();
    expect(view.getByText('Handed over the fix')).toBeTruthy();
    expect(view.getByText('Reported 1 finding')).toBeTruthy();
    expect(view.getByText('Missing test.')).toBeTruthy();
    expect(view.getByText('Asked you')).toBeTruthy();
    expect(view.getByText('Which colour?')).toBeTruthy();
    expect(view.getByText('Blue')).toBeTruthy();
    expect(view.queryByRole('button', { name: /Worked for/ })).toBeNull();
  });

  it('starts a new turn with its own fold when you send a message', () => {
    const task = createTask({
      id: 'task-1',
      activity: [
        {
          at: at(90),
          actor: 'you',
          kind: 'message',
          text: 'You sent a message',
          detail: 'Use zod too.',
          evidenceId: null,
        },
      ],
    });
    pushTranscript('run-1', [
      ...workEntries(),
      createEntry(
        { type: 'tool_call', callId: 'z1', tool: { kind: 'edit', path: 'src/form.ts', hunks: [] } },
        'z1',
        at(100)
      ),
      createEntry(
        { type: 'tool_result', callId: 'z1', status: 'ok', output: '', images: [] },
        'zr1',
        at(101)
      ),
      createEntry({ type: 'agent', phase: 'final', text: 'Switched to zod.' }, 'z-final', at(175)),
    ]);
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    const rows = view.getAllByRole('button', { name: /Worked for/ });
    expect(rows).toHaveLength(2);
    expect(view.getByText('Use zod too.')).toBeTruthy();
    expect(view.getByText('Switched to zod.')).toBeTruthy();
    const text = view.container.textContent ?? '';
    expect(text.indexOf('Use zod too.')).toBeLessThan(text.indexOf('Switched to zod.'));
    expect(rows[1]?.textContent).toBe('Worked for 1m · 1 step');
  });

  it('highlights the run named in the address', async () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', workEntries());
    pushTranscript('run-2', workEntries('b-'));
    const runs = [finishedRun(), finishedRun({ id: 'run-2', startedAt: at(200), endedAt: at(250) })];
    const view = renderChat(createShinsaState({ tasks: [task], runs }), task, 'run-2');
    await act(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    expect(view.container.querySelector('#run-run-2')?.hasAttribute('data-focused')).toBe(true);
    expect(view.container.querySelector('#run-run-1')?.hasAttribute('data-focused')).toBe(false);
  });

  it('explains an empty chat while Shinsa sets the task up', () => {
    const task = createTask({ id: 'task-1', stage: 'triage' });
    const view = renderChat(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('Shinsa is setting up the task')).toBeTruthy();
  });

  it('explains an empty chat while the task waits on another', () => {
    const task = createTask({ id: 'task-1', stage: 'queued' });
    const view = renderChat(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('Not started yet')).toBeTruthy();
    expect(view.getByText('An agent picks this task up when the task it waits on is finished.')).toBeTruthy();
  });

  it('explains an empty chat before any agent has run', () => {
    const task = createTask({ id: 'task-1' });
    const view = renderChat(createShinsaState({ tasks: [task] }), task);
    expect(view.getByText('No agent has run yet')).toBeTruthy();
  });

  it('hides the composer once the task is closed', () => {
    const task = createTask({ id: 'task-1', stage: 'done', closedAt: 1 });
    const view = renderChat(createShinsaState({ tasks: [task] }), task);
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('sends what you type to the agent as a task message and says what it does', async () => {
    const toasts = spyOnToasts();
    const task = createTask({ id: 'task-1' });
    const view = renderChat(createShinsaState({ tasks: [task] }), task);
    const field = view.getByRole('textbox', {
      name: 'Tell the agent something. The step starts again with your message.',
    });
    fireEvent.change(field, { target: { value: '  Use zod.  ' } });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Send message' }));
    });
    expect(listSentCommands()).toEqual([{ type: 'task.message', taskId: 'task-1', text: 'Use zod.' }]);
    expect((field as HTMLTextAreaElement).value).toBe('');
    expect(toasts.success).toHaveBeenCalledWith('Sent. The step starts again with your message.');
    toasts.restore();
  });

  it('shows a failed run with its error instead of a reply', () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', [
      ...workEntries().slice(0, 4),
      createEntry({ type: 'error', text: 'The agent ran out of turns.' }, 'err', at(100)),
    ]);
    const view = renderChat(
      createShinsaState({ tasks: [task], runs: [finishedRun({ outcome: 'failed' })] }),
      task
    );
    const section = view.container.querySelector('#run-run-1') as HTMLElement;
    expect(within(section).getByText('The agent ran out of turns.')).toBeTruthy();
    expect(within(section).getByText(/Failed/)).toBeTruthy();
  });

  it('names the account each run used, and runs the current step again on the account you pick', async () => {
    pushAccounts(
      createSnapshot({
        accounts: [
          createAccount({ id: 'w', email: 'work@example.com' }),
          createAccount({ id: 'h', email: 'home@example.com' }),
        ],
      })
    );
    const task = createTask({ id: 'task-1', stage: 'building' });
    const attempt = {
      attemptId: 'a',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt: 1,
    };
    const earlier = finishedRun({
      attempts: [{ ...attempt, account: { id: 'h', email: 'home@example.com' } }],
    });
    const current = createRun({
      id: 'run-2',
      taskId: 'task-1',
      startedAt: at(200),
      attempts: [{ ...attempt, account: { id: 'w', email: 'work@example.com' } }],
    });
    pushTranscript('run-1', workEntries());
    pushTranscript('run-2', workEntries('b'));
    const view = renderChat(createShinsaState({ tasks: [task], runs: [earlier, current] }), task);
    const first = view.container.querySelector('#run-run-1') as HTMLElement;
    expect(within(first).getByText('· home@example.com')).toBeTruthy();
    expect(within(first).queryByRole('button', { name: '· home@example.com' })).toBeNull();
    fireEvent.click(view.getByRole('button', { name: '· work@example.com' }));
    expect(await view.findByText('Run this step again on')).toBeTruthy();
    expect(
      view.getAllByRole('menuitemradio').map((item) => [item.textContent, item.getAttribute('aria-checked')])
    ).toEqual([
      ['work@example.com', 'true'],
      ['home@example.com', 'false'],
    ]);
    fireEvent.click(view.getByRole('menuitemradio', { name: 'home@example.com' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.retry', taskId: 'task-1', account: { id: 'h', email: 'home@example.com' } },
      ])
    );
  });
});

describe('a task that runs in rounds', () => {
  const OPEN = {
    number: 12,
    url: 'https://github.com/o/r/pull/12',
    state: 'open' as const,
    checks: 'passing' as const,
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: 0,
  };

  function roundsTask() {
    return createTask({
      id: 'task-1',
      stage: 'building',
      pullRequest: OPEN,
      rounds: [
        createRound({
          number: 1,
          title: 'Add MCP v2',
          status: 'shipped',
          pullRequest: { ...OPEN, base: 'main' },
        }),
        createRound({
          number: 2,
          title: 'Stream the tool results',
          status: 'active',
          request: 'Also stream them',
          outcome: null,
        }),
        createRound({
          number: 3,
          title: 'Cache the server list',
          status: 'queued',
          startedAt: null,
          pullRequest: null,
          outcome: null,
        }),
      ],
    });
  }

  it('shows each round as a section with its title, its pull request and how it ships, earlier ones folded', async () => {
    const task = roundsTask();
    const runs = [
      finishedRun({ id: 'run-1', role: 'planner' }),
      finishedRun({
        id: 'run-2',
        role: 'planner',
        round: 2,
        startedAt: at(200),
        endedAt: null,
        outcome: null,
      }),
    ];
    const view = renderChat(createShinsaState({ tasks: [task], runs }), task);
    const [first, second, third] = view
      .getAllByRole('region')
      .filter((region) => /^Round/.test(region.getAttribute('aria-label') ?? ''));
    expect(first && within(first).getByText('Add MCP v2')).toBeTruthy();
    expect(first && within(first).getByText('On its pull request')).toBeTruthy();
    expect(
      first &&
        within(first)
          .getByRole('button', { name: /Round 1/ })
          .getAttribute('aria-expanded')
    ).toBe('false');
    expect(second && within(second).getByText('Also stream them')).toBeTruthy();
    expect(
      second &&
        within(second)
          .getByRole('button', { name: /Round 2/ })
          .getAttribute('aria-expanded')
    ).toBe('true');
    expect(third && within(third).getByText('Waiting to start')).toBeTruthy();
    expect(third && within(third).getByRole('combobox', { name: 'How round 3 ships' })).toBeTruthy();
    expect(view.getAllByRole('link', { name: /#12/ }).length).toBeGreaterThan(0);
    await act(async () => {
      fireEvent.click(first ? within(first).getByRole('button', { name: /Round 1/ }) : document.body);
    });
    expect(
      first &&
        within(first)
          .getByRole('button', { name: /Round 1/ })
          .getAttribute('aria-expanded')
    ).toBe('true');
  });

  it('opens an earlier round when the chat is focused on one of its runs', () => {
    const task = roundsTask();
    const runs = [finishedRun({ id: 'run-1', role: 'planner' })];
    const view = renderChat(createShinsaState({ tasks: [task], runs }), task, 'run-1');
    expect(view.getByRole('button', { name: /Round 1/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens an earlier round when the chat is focused on a run another agent delegated inside it', () => {
    const task = roundsTask();
    const runs = [
      finishedRun({ id: 'run-1', role: 'planner' }),
      finishedRun({
        id: 'child',
        role: 'reviewer',
        delegation: {
          parentRunId: 'run-1',
          depth: 1,
          requestKey: 'survey',
          title: 'Survey the tests',
          brief: 'Look.',
          mode: 'async',
          wake: 'always',
          isolation: 'shared',
          baseCommit: null,
          delivery: 'none',
          question: null,
          requestedAt: at(10),
        },
      }),
      finishedRun({
        id: 'run-2',
        role: 'planner',
        round: 2,
        startedAt: at(200),
        endedAt: null,
        outcome: null,
      }),
    ];
    const view = renderChat(createShinsaState({ tasks: [task], runs }), task, 'child');
    expect(view.getByRole('button', { name: /Round 1/ }).getAttribute('aria-expanded')).toBe('true');
  });
});
