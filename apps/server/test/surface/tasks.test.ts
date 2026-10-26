import { describe, expect, test } from 'bun:test';
import { PLAIN_STYLE } from '../../src/terminal/index.ts';
import {
  BASE,
  COLOR_DISPLAY,
  createAccountsSnapshot,
  createFakeClient,
  createTaskDetail,
  runSpec,
} from './fixtures.ts';

const DETAIL = createTaskDetail();

const OTHER = createTaskDetail({ task: { id: 'task-456', title: 'Add search' } });

const TASKS = {
  '/api/tasks/fix': DETAIL,
  '/api/tasks/task-123': DETAIL,
  '/api/tasks/search': OTHER,
  '/api/accounts': createAccountsSnapshot(),
  '/api/repos': { repos: [{ id: 'repo-1', name: 'app' }] },
};

describe('tasks list', () => {
  test('lists one line per task with its state, decision and repository', async () => {
    const fake = createFakeClient({
      '/api/tasks': {
        tasks: [
          {
            id: 'task-1',
            handle: 'SW-1',
            title: 'Fix the scroll',
            status: 'building',
            stage: 'building',
            decision: null,
            repo: 'app',
          },
          {
            id: 'task-2',
            title: 'Add search',
            status: 'changes to review',
            stage: 'awaiting_review',
            decision: { type: 'review', title: 'Review the changes' },
            repo: null,
          },
        ],
      },
    });
    const result = await runSpec(fake, ['tasks', 'list']);
    expect(fake.reads).toEqual(['/api/tasks']);
    expect(result.text.split('\n')).toEqual([
      'Task    Title           Status              Repository',
      'SW-1    Fix the scroll  building            app',
      'task-2  Add search      Review the changes',
    ]);
  });

  test('in a terminal the table has dim headers, a status coloured by what it waits for, and fits the width', async () => {
    const tasks = [
      {
        id: 'a',
        handle: 'SW-1',
        title: 'Merged work',
        status: 'merged',
        stage: 'merged',
        decision: null,
        repo: null,
      },
      {
        id: 'b',
        handle: 'SW-2',
        title: 'Cancelled',
        status: 'cancelled',
        stage: 'cancelled',
        decision: null,
        repo: null,
      },
      {
        id: 'c',
        handle: 'SW-3',
        title: 'Broke',
        status: 'fixing',
        stage: 'fixing',
        decision: { type: 'failure', title: 'Out of fix rounds' },
        repo: null,
      },
      {
        id: 'd',
        handle: 'SW-4',
        title: 'Asks',
        status: 'answering',
        stage: 'answering',
        decision: { type: 'question', title: 'Which?' },
        repo: null,
      },
      {
        id: 'e',
        handle: 'SW-5',
        title: 'Works',
        status: 'building',
        stage: 'building',
        decision: null,
        repo: null,
      },
    ];
    const fake = createFakeClient({ '/api/tasks': { tasks } });
    const lines = (await runSpec(fake, ['tasks', 'list'], COLOR_DISPLAY)).text.split('\n');
    expect(lines[0]).toBe(
      '\u001b[2mTask\u001b[22m  \u001b[2mTitle\u001b[22m        \u001b[2mStatus\u001b[22m'
    );
    expect(lines.slice(1).map((line) => line.split('  ').at(-1)?.trim())).toEqual([
      '\u001b[32mmerged\u001b[39m',
      '\u001b[2mcancelled\u001b[22m',
      '\u001b[31mOut of fix rounds\u001b[39m',
      '\u001b[33mWhich?\u001b[39m',
      '\u001b[36mbuilding\u001b[39m',
    ]);
    const narrow = await runSpec(
      createFakeClient({
        '/api/tasks': { tasks: [{ ...tasks[4], title: 'A title much longer than the terminal is wide' }] },
      }),
      ['tasks', 'list'],
      { style: PLAIN_STYLE, width: 40 }
    );
    expect(narrow.text.split('\n')).toEqual([
      'Task  Title                     Status',
      'SW-5  A title much longer tha…  building',
    ]);
  });

  test('passes its filters to the server and says when nothing matches', async () => {
    const path = '/api/tasks?status=needs_you&q=tab+scroll&repo=app&limit=5';
    const fake = createFakeClient({ [path]: { tasks: [] } });
    const result = await runSpec(fake, [
      'tasks',
      'list',
      '--status',
      'needs_you',
      '--query',
      'tab scroll',
      '--repo',
      'app',
      '--limit',
      '5',
    ]);
    expect(fake.reads).toEqual([path]);
    expect(result).toEqual({ data: { tasks: [] }, text: 'No tasks.' });
  });
});

describe('tasks show and diff', () => {
  test('show prints the server’s description of the task', async () => {
    const fake = createFakeClient({ '/api/tasks/Fix%20the%20tab%20scroll': DETAIL });
    const result = await runSpec(fake, ['tasks', 'show', 'Fix the tab scroll']);
    expect(result.text).toBe('Fix the tab scroll\nBuilding.');
  });

  test('diff lists each changed file against the base, or says there is nothing', async () => {
    const diff = {
      base: 'main',
      files: [
        { status: 'modified', path: 'src/a.ts', additions: 3, deletions: 1 },
        { status: 'added', path: 'src/b.ts', additions: 10, deletions: 0 },
      ],
    };
    const fake = createFakeClient({ ...TASKS, '/api/tasks/task-123/diff': diff });
    expect((await runSpec(fake, ['tasks', 'diff', 'fix'])).text).toBe(
      'Changes against main:\n  modified src/a.ts  +3 -1\n  added    src/b.ts  +10 -0'
    );
    expect(fake.reads).toEqual(['/api/tasks/fix', '/api/tasks/task-123/diff']);
    const clean = createFakeClient({ ...TASKS, '/api/tasks/task-123/diff': { base: 'main', files: [] } });
    expect((await runSpec(clean, ['tasks', 'diff', 'fix'])).text).toBe('No changes against main.');
  });
});

describe('tasks chat', () => {
  test('reads the chat page with its filters and prints each entry by who said it', async () => {
    const path = '/api/tasks/fix/chat?run=run-1&kinds=user%2Cagent%2Ctool_call&after=3&limit=4';
    const page = {
      taskId: 'task-123',
      runs: [{ id: 'run-1', role: 'builder' }],
      entries: [
        { index: 4, runId: 'run-1', type: 'user', from: 'you', text: 'Use flexbox.' },
        { index: 5, runId: 'run-1', type: 'user', from: 'shinsa', text: 'Build phase 1.' },
        { index: 6, runId: 'run-1', type: 'agent', phase: 'interim', text: 'Looking.' },
        { index: 7, runId: 'run-9', type: 'agent', phase: 'final', text: 'Done.' },
        { index: 8, runId: 'run-1', type: 'error', text: 'The run crashed.' },
        { index: 9, runId: 'run-1', type: 'tool_call', id: 'c1' },
      ],
      next: 9,
    };
    const fake = createFakeClient({ [path]: page });
    const result = await runSpec(fake, [
      'tasks',
      'chat',
      'fix',
      '--run',
      'run-1',
      '--kinds',
      'user,agent',
      '--kinds',
      'tool_call',
      '--after',
      '3',
      '--limit',
      '4',
    ]);
    expect(fake.reads).toEqual([path]);
    expect(result.text.split('\n')).toEqual([
      '#4 you → builder: Use flexbox.',
      '#5 Shinsa → builder: Build phase 1.',
      '#6 builder (working): Looking.',
      '#7 agent: Done.',
      '#8 builder failed: The run crashed.',
      '#9 builder tool_call: {"index":9,"runId":"run-1","type":"tool_call","id":"c1"}',
      'More after #9: add --after 9.',
    ]);
  });

  test('an empty chat says so', async () => {
    const fake = createFakeClient({
      '/api/tasks/fix/chat': { taskId: 't', runs: [], entries: [], next: null },
    });
    expect((await runSpec(fake, ['tasks', 'chat', 'fix'])).text).toBe('Nothing in the chat yet.');
  });
});

describe('tasks create', () => {
  test('sends the request alone, and prints where to follow the task', async () => {
    const fake = createFakeClient({}, 'task-new');
    const result = await runSpec(fake, ['tasks', 'create', 'fix', 'the', 'scroll']);
    expect(fake.sent).toEqual([{ type: 'task.create', request: 'fix the scroll', repoId: null }]);
    expect(result).toEqual({
      data: { ok: true, taskId: 'task-new' },
      text: `Created the task. Shinsa brings it back when it needs a decision.\n${BASE}/tasks/task-new`,
    });
  });

  test('resolves the repository, the tasks it waits on and the account by name', async () => {
    const fake = createFakeClient(TASKS);
    await runSpec(fake, [
      'tasks',
      'create',
      'add search',
      '--repo',
      'app',
      '--priority',
      'high',
      '--plan-first',
      '--ask',
      '--after',
      'fix,search',
      '--account',
      'ME@example.com',
    ]);
    expect(fake.sent).toEqual([
      {
        type: 'task.create',
        request: 'add search',
        repoId: 'repo-1',
        priority: 'high',
        planFirst: true,
        mode: 'ask',
        waitsOn: ['task-123', 'task-456'],
        account: { id: 'acc-1', email: 'me@example.com' },
      },
    ]);
  });

  test('an unknown repository or account is refused before anything is sent', async () => {
    const fake = createFakeClient(TASKS);
    await expect(runSpec(fake, ['tasks', 'create', 'x', '--repo', 'web'])).rejects.toThrow(
      'No repository web. `shinsa repos list` lists them.'
    );
    await expect(runSpec(fake, ['tasks', 'create', 'x', '--account', 'acc-9'])).rejects.toThrow(
      'No account acc-9. `shinsa accounts list` lists them.'
    );
    expect(fake.sent).toEqual([]);
  });
});

describe('the task commands', () => {
  const ACCOUNT = { id: 'acc-1', email: 'me@example.com' };
  const cases: [string[], unknown, string][] = [
    [
      ['tasks', 'message', 'fix', 'use', 'flexbox'],
      { type: 'task.message', taskId: 'task-123', text: 'use flexbox' },
      'Sent.',
    ],
    [
      ['tasks', 'message', 'fix', 'add', 'search', '--as', 'new_round'],
      { type: 'task.message', taskId: 'task-123', text: 'add search', kind: 'new_round' },
      'Sent.',
    ],
    [
      ['rounds', 'ship', 'fix', '2', 'stacked'],
      { type: 'round.ship', taskId: 'task-123', number: 2, shipping: 'stacked' },
      'Saved how the round ships.',
    ],
    [['tasks', 'retry', 'fix'], { type: 'task.retry', taskId: 'task-123' }, 'Retrying.'],
    [
      ['tasks', 'retry', 'fix', '--account', 'acc-1'],
      { type: 'task.retry', taskId: 'task-123', account: ACCOUNT },
      'Retrying.',
    ],
    [
      ['tasks', 'rerun', 'fix', 'acc-1'],
      { type: 'task.retry', taskId: 'task-123', account: ACCOUNT },
      'Running this step again on acc-1.',
    ],
    [['tasks', 'cancel', 'fix'], { type: 'task.cancel', taskId: 'task-123' }, 'Cancelled.'],
    [['tasks', 'done', 'fix'], { type: 'task.complete', taskId: 'task-123' }, 'Marked as done.'],
    [
      ['tasks', 'prioritize', 'fix', 'urgent'],
      { type: 'task.prioritize', taskId: 'task-123', priority: 'urgent' },
      'Priority set to urgent.',
    ],
    [
      ['tasks', 'wait-on', 'fix', 'search'],
      { type: 'task.wait_on', taskId: 'task-123', waitsOn: ['task-456'] },
      'Saved what it waits on.',
    ],
    [
      ['tasks', 'stop-waiting', 'fix'],
      { type: 'task.wait_on', taskId: 'task-123', waitsOn: [] },
      'It no longer waits on other tasks.',
    ],
    [
      ['tasks', 'bind', 'fix', 'any'],
      { type: 'task.bind_account', taskId: 'task-123', account: null },
      'Saved the account.',
    ],
    [
      ['tasks', 'bind', 'fix', 'me@example.com'],
      { type: 'task.bind_account', taskId: 'task-123', account: ACCOUNT },
      'Saved the account.',
    ],
    [
      ['tasks', 'check-in-now', 'fix'],
      { type: 'monitor.check_in_now', taskId: 'task-123' },
      'Checking in now.',
    ],
    [['tasks', 'resume-now', 'fix'], { type: 'usage_wait.resume_now', taskId: 'task-123' }, 'Resuming.'],
    [
      ['tasks', 'auto-resume', 'fix', 'true'],
      { type: 'usage_wait.change', taskId: 'task-123', autoResume: true },
      'It resumes at the reset.',
    ],
    [
      ['tasks', 'auto-resume', 'fix', 'no'],
      { type: 'usage_wait.change', taskId: 'task-123', autoResume: false },
      'It waits for you at the reset.',
    ],
  ];

  for (const [words, command, text] of cases) {
    test(`shinsa ${words.join(' ')} sends ${(command as { type: string }).type}`, async () => {
      const fake = createFakeClient(TASKS);
      const result = await runSpec(fake, words);
      expect(fake.sent).toEqual([command as never]);
      expect(result.text).toBe(text);
    });
  }
});

describe('tasks open', () => {
  test('opens the worktree in the editor by default, or where asked, and says when it could not', async () => {
    const fake = createFakeClient({
      ...TASKS,
      '/api/tasks/task-123/open': (_path: string, body: unknown) => ({
        ok: (body as { target: string }).target !== 'finder',
      }),
    });
    expect((await runSpec(fake, ['tasks', 'open', 'fix'])).text).toBe('Opened.');
    expect((await runSpec(fake, ['tasks', 'open', 'fix', 'finder'])).text).toBe('Could not open it.');
    expect(fake.posts).toEqual([
      { path: '/api/tasks/task-123/open', body: { target: 'editor' } },
      { path: '/api/tasks/task-123/open', body: { target: 'finder' } },
    ]);
  });
});
