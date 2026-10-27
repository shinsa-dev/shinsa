import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { type ChatEntry, type Run, type ShinsaState, serializeState, type Task } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react';
import { ChatTab } from '@/routes/task/chat.tsx';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { findTooltipText } from '../../support/hover.ts';
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
import { listStretchedTriggers } from '../../support/triggers.ts';

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
  pushAccounts(createSnapshot());
  setSystemTime(new Date(NOW));
});

afterEach(() => {
  stopFakeServer();
  setSystemTime();
});

describe('ChatTab', () => {
  it('folds a finished run into one worked row, with the hand-over as its reply and the words after it inside', () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', workEntries());
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    const row = view.getByRole('button', { name: /Worked for/ });
    expect(row.textContent).toBe('Worked for 3m · 6 steps');
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(view.getByText('Handed over the phase')).toBeTruthy();
    expect(view.queryByText('The login form is done.')).toBeNull();
    expect(view.queryByText('Looking around the code first.')).toBeNull();
    expect(view.queryByText(/Read 2 files/)).toBeNull();
  });

  it('opens the fold onto the interim messages and the tool rows', () => {
    const task = createTask({ id: 'task-1' });
    pushTranscript('run-1', workEntries());
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    fireEvent.click(view.getByRole('button', { name: /Worked for/ }));
    expect(view.getByText('Looking around the code first.')).toBeTruthy();
    expect(view.getByText('The login form is done.')).toBeTruthy();
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
        args: { goal: 'Ship the form.', phases: [{ title: 'Add fields', detail: 'Two' }] },
      },
      {
        name: 'complete_fix',
        args: { summary: 'Fixed the null check.', walkthrough: { flow: 'Now it checks first.' } },
      },
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
    expect(view.getByRole('link', { name: 'Read the walkthrough' }).getAttribute('href')).toBe(
      '/tasks/task-1?tab=review'
    );
    expect(view.getAllByRole('link', { name: 'Read the walkthrough' })).toHaveLength(1);
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
    const task = createTask({ id: 'task-1', stage: 'waiting_on_tasks' });
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
    expect(toasts.success).toHaveBeenCalledWith('Sent. Restarting the step.');
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

  it('reads as one agent working through the round: each run headed Agent with what it did', () => {
    const document = {
      goal: 'Goal',
      phases: [
        { title: 'Add the form', detail: 'a' },
        { title: 'Wire the API', detail: 'b' },
      ],
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [],
      questions: [],
    };
    const task = createTask({
      id: 'task-1',
      plan: { version: 1, body: '', document, proposedAt: STARTED },
    });
    const run = (id: string, seconds: number, overrides: Partial<Run>) =>
      finishedRun({ id, startedAt: at(seconds), endedAt: at(seconds + 1), ...overrides });
    const runs = [
      run('plan', 0, { purpose: 'plan' }),
      run('phase-1', 10, { purpose: 'build', phaseIndex: 0 }),
      run('phase-2', 20, { purpose: 'build', phaseIndex: 1 }),
      run('fix', 30, { purpose: 'fix', prompt: 'The checks failed after the last change:' }),
      run('review', 40, { role: 'reviewer' }),
    ];
    const view = renderChat(serializeState(createShinsaState({ tasks: [task], runs })), task);
    const headers = [...view.container.querySelectorAll('section[id^="run-"] > [data-chat-line]')].map(
      (header) => header.textContent ?? ''
    );
    expect(headers.map((header) => header.trim())).toEqual([
      'Agent · Planned 2 phases',
      'Agent · Phase 1 of 2: Add the form',
      'Agent · Phase 2 of 2: Wire the API',
      'Agent · Fixed the failing checks',
      'Reviewer · Reviewed the change',
    ]);
  });

  it('shows a run headline the role header cuts short in full in its tooltip', async () => {
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.dataset.slot === 'truncate' ? this.clientWidth + 100 : 0;
      },
    });
    try {
      const task = createTask({ id: 'task-1' });
      pushTranscript('run-1', workEntries());
      const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
      const header = view.container.querySelector('#run-run-1 [data-chat-line]') as HTMLElement;
      const headline = header.querySelector('[data-slot="truncate"]') as HTMLElement;
      expect(headline.textContent).not.toBe('');
      expect(await findTooltipText(headline)).toBe(headline.textContent ?? '');
    } finally {
      if (width) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', width);
      else Reflect.deleteProperty(HTMLElement.prototype, 'scrollWidth');
    }
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
          startedAt: NOW - 7_200_000,
          endedAt: null,
          outcome: null,
        }),
        createRound({
          number: 3,
          title: 'Cache the server list',
          status: 'waiting',
          startedAt: null,
          pullRequest: null,
          outcome: null,
        }),
      ],
    });
  }

  function roundRuns() {
    return [
      finishedRun({ id: 'run-1', purpose: 'plan' }),
      finishedRun({
        id: 'run-2',
        purpose: 'plan',
        round: 2,
        startedAt: at(200),
        endedAt: null,
        outcome: null,
      }),
    ];
  }

  it('runs the rounds on as one chat: a divider where each starts, its request, then its runs, nothing folded', () => {
    const task = roundsTask();
    const view = renderChat(createShinsaState({ tasks: [task], runs: roundRuns() }), task);
    expect(view.getAllByRole('heading', { level: 2 }).map((divider) => divider.textContent)).toEqual([
      'Round 1 · Add MCP v2 · On its pull request',
      'Round 2 · Stream the tool results · In progress',
      'Round 3 · Cache the server list · Waiting to start',
    ]);
    const text = view.container.textContent ?? '';
    const order = [
      'Add MCP v2',
      'Do round 1',
      'Stream the tool results',
      'Also stream them',
      'Cache the server list',
    ];
    expect(order.map((part) => text.indexOf(part))).toEqual(
      [...order.map((part) => text.indexOf(part))].sort((left, right) => left - right)
    );
    expect(view.container.querySelector('#run-run-1')).toBeTruthy();
    expect(view.container.querySelector('#run-run-2')).toBeTruthy();
    expect(view.container.querySelector('[aria-expanded][aria-label^="Round"]')).toBeNull();
    expect(view.queryByRole('region', { name: /^Round/ })).toBeNull();
    expect(view.queryByRole('combobox', { name: 'How round 3 ships' })).toBeNull();
    expect(view.queryByRole('list', { name: 'Progress' })).toBeNull();
  });

  it('names the round and when it started or ended in the divider’s tooltip', async () => {
    const task = roundsTask();
    const view = renderChat(createShinsaState({ tasks: [task], runs: roundRuns() }), task);
    const [, current] = view.getAllByRole('heading', { level: 2 });
    const trigger = current?.querySelector<HTMLElement>('[data-slot="tooltip-trigger"]');
    expect(trigger && (await findTooltipText(trigger))).toBe(
      'Round 2: Stream the tool resultsStarted 2h ago'
    );
  });

  it('scrolls a linked run of an earlier round into view and washes it', async () => {
    const scrolled: Element[] = [];
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      scrolled.push(this);
    };
    try {
      const task = roundsTask();
      const view = renderChat(createShinsaState({ tasks: [task], runs: roundRuns() }), task, 'run-1');
      const run = view.container.querySelector('#run-run-1') as HTMLElement;
      await waitFor(() => expect(run.hasAttribute('data-focused')).toBe(true));
      expect(scrolled.every((element) => run.contains(element))).toBe(true);
      expect(scrolled.length).toBeGreaterThan(0);
    } finally {
      HTMLElement.prototype.scrollIntoView = original;
    }
  });
});

describe('tooltips in the chat', () => {
  it('open only over a row’s text and icon, never over the empty rest of the row', async () => {
    const task = createTask({
      id: 'task-1',
      rounds: [
        createRound({ number: 1, title: 'Add MCP v2', status: 'finished' }),
        createRound({ number: 2, title: 'Stream the tool results', status: 'active', endedAt: null }),
      ],
    });
    pushTranscript('run-1', [
      createEntry(
        {
          type: 'notice',
          notice: { kind: 'account_switched', email: 'b@example.com', previous: null, reason: 'usage_limit' },
        },
        'n1',
        at(1)
      ),
      createEntry(
        {
          type: 'notice',
          notice: { kind: 'compaction', trigger: 'auto', preTokens: 180_000, summary: null },
        },
        'n2',
        at(2)
      ),
      createEntry(
        {
          type: 'tool_call',
          callId: 'e1',
          tool: { kind: 'edit', path: 'src/login.ts', hunks: [{ before: 'a', after: 'b\nc' }] },
        },
        'e1',
        at(3)
      ),
      createEntry(
        { type: 'tool_result', callId: 'e1', status: 'ok', output: 'ok', images: [] },
        'e1r',
        at(4)
      ),
      ...workEntries('w'),
    ]);
    const view = renderChat(createShinsaState({ tasks: [task], runs: [finishedRun()] }), task);
    fireEvent.click(view.getByRole('button', { name: /Worked for/ }));
    const triggers = view.container.querySelectorAll('[data-slot="tooltip-trigger"]');
    expect(triggers.length).toBeGreaterThan(3);
    expect(listStretchedTriggers(view.container)).toEqual([]);
    expect(view.getByRole('button', { name: /^Account switched/ }).hasAttribute('data-chat-line')).toBe(true);
  });

  it('counts a block-level trigger with no fitted width as stretched', () => {
    const row = document.createElement('div');
    row.innerHTML = [
      '<div data-slot="tooltip-trigger" class="flex items-center">stretched</div>',
      '<span data-slot="tooltip-trigger" class="flex w-fit">fitted</span>',
      '<span data-slot="tooltip-trigger">inline</span>',
      '<span data-slot="truncate" class="block min-w-0">clipped</span>',
    ].join('');
    expect(listStretchedTriggers(row).map((trigger) => trigger.textContent)).toEqual(['stretched']);
  });
});

describe('a follow-up and the next round in the chat', () => {
  function answerEntries(id: string, answer: string, start: number): ChatEntry[] {
    return [
      createEntry(
        { type: 'user', from: 'shinsa', text: 'Answer it.', attachments: [] },
        `${id}-brief`,
        at(start)
      ),
      createEntry(
        { type: 'tool_call', callId: `${id}-c`, tool: { kind: 'shinsa', name: 'answer', args: { answer } } },
        `${id}-call`,
        at(start + 5)
      ),
      createEntry(
        { type: 'tool_result', callId: `${id}-c`, status: 'ok', output: 'Delivered.', images: [] },
        `${id}-result`,
        at(start + 6)
      ),
    ];
  }

  function answered(overrides: Partial<Task> = {}) {
    return createTask({
      id: 'task-1',
      stage: 'done',
      pipeline: ['answer'],
      activity: [
        {
          at: STARTED - 1000,
          actor: 'you',
          kind: 'asked',
          text: 'Asked for this',
          detail: 'hey',
          evidenceId: null,
        },
        {
          at: at(200),
          actor: 'you',
          kind: 'message',
          text: 'Sent instructions',
          detail: 'hey!',
          evidenceId: null,
        },
      ],
      ...overrides,
    });
  }

  it('never repeats the earlier answer under a message the next run has not picked up yet', () => {
    const task = answered();
    pushTranscript('run-1', answerEntries('one', 'Hey! I am the answerer.', 0));
    const view = renderChat(
      createShinsaState({
        tasks: [task],
        runs: [finishedRun({ role: 'answerer', summary: 'Hey! I am the answerer.', endedAt: at(10) })],
      }),
      task
    );
    expect(view.getAllByText('Hey! I am the answerer.')).toHaveLength(1);
    expect(view.getByText('hey!')).toBeTruthy();
  });

  it('opens the next run with your message above its role, never under the finished run', () => {
    const task = answered();
    pushTranscript('run-1', answerEntries('one', 'Hey! I am the answerer.', 0));
    pushTranscript('run-2', answerEntries('two', 'Still here.', 210));
    const view = renderChat(
      createShinsaState({
        tasks: [task],
        runs: [
          finishedRun({ role: 'answerer', summary: 'Answered the question.', endedAt: at(10) }),
          finishedRun({
            id: 'run-2',
            role: 'answerer',
            startedAt: at(205),
            summary: 'Answered the question.',
          }),
        ],
      }),
      task
    );
    const second = view.container.querySelector('#run-run-2') as HTMLElement;
    expect(within(second).getByText('hey!')).toBeTruthy();
    expect(within(second).getAllByText('Answerer')).toHaveLength(1);
    const text = second.textContent ?? '';
    expect(text.indexOf('hey!')).toBeLessThan(text.indexOf('Answerer'));
    expect(view.queryByText('Answered the question.')).toBeNull();
  });

  it('keeps each round’s request under its own divider, and an earlier round stays open once the next one starts', () => {
    const one = createRound({
      number: 1,
      title: 'Respond to greeting',
      request: 'hey',
      pipeline: ['answer'],
    });
    const two = createRound({
      number: 2,
      title: 'Say what you can do',
      request: 'what can u do',
      pipeline: ['answer'],
    });
    const runs = [finishedRun({ role: 'answerer', summary: 'Answered.', endedAt: at(10) })];
    pushTranscript('run-1', answerEntries('one', 'Hey! I am the answerer.', 0));
    const queued = answered({
      rounds: [
        { ...one, status: 'active', endedAt: null, outcome: null },
        { ...two, status: 'waiting', startedAt: null, endedAt: null, outcome: null },
      ],
    });
    const view = renderChat(createShinsaState({ tasks: [queued], runs }), queued);
    expect(view.getAllByText('hey')).toHaveLength(1);
    expect(view.getAllByRole('heading', { level: 2 })).toHaveLength(2);
    const started = answered({
      rounds: [
        { ...one, status: 'finished' },
        { ...two, status: 'active', endedAt: null, outcome: null },
      ],
    });
    const state = createShinsaState({ tasks: [started], runs });
    pushState(state);
    view.rerender(
      <TooltipProvider>
        <ChatTab state={state} task={started} />
      </TooltipProvider>
    );
    const text = view.container.textContent ?? '';
    expect(view.getByText('hey')).toBeTruthy();
    expect(view.getByText('Hey! I am the answerer.')).toBeTruthy();
    expect(text.indexOf('Hey! I am the answerer.')).toBeLessThan(text.indexOf('what can u do'));
    expect(view.getAllByRole('heading', { level: 2 }).map((divider) => divider.textContent)).toEqual([
      'Round 1 · Respond to greeting · Finished',
      'Round 2 · Say what you can do · In progress',
    ]);
  });
});
