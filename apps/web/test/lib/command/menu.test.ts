import { describe, expect, it } from 'bun:test';
import type { Task } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  arrangeByScore,
  type ChoiceCommand,
  isCommandShown,
  listChoiceCommands,
  listCommandKeywords,
  listDecisionCommands,
  listListedTaskIds,
  listMenuTasks,
  listOptionKeywords,
  listRecentTasks,
  listRootBlocks,
  listSearchCommands,
  listSectionBlocks,
  listTaskKeywords,
  type MenuBlock,
  NEW_TASK_COMMAND,
  requestNewTaskOnHome,
  resolveCrumb,
  resolveFirstValue,
  resolvePlaceholder,
  resolveRepoName,
  TASKS_FRAME,
} from '@/lib/command/menu.ts';
import { type ChoiceOption, type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { useNewTaskRequest } from '@/lib/new-task.ts';
import { resolveTaskStatus } from '@/lib/tasks/status.ts';
import { navigate } from '@/router.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { createGate, createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

function runCommand(id: string, extra: Partial<Command> = {}): Command {
  return { kind: 'run', id, label: id, run: () => {}, ...extra } as Command;
}

function choice(value: string | string[] | null): ChoiceCommand {
  return {
    kind: 'choice',
    id: 'appearance.theme',
    label: 'Change theme…',
    heading: 'Theme',
    value,
    options: [
      { value: 'system', label: 'System' },
      { value: 'dark', label: 'Dark', keywords: ['night'] },
    ],
    pick: () => {},
  };
}

function list(sections: CommandSection[]) {
  return { kind: 'list' as const, crumb: 'Cancel task', placeholder: 'Cancel this task?', sections };
}

describe('resolveRepoName', () => {
  it('names the repository, or nothing when there is none or it is unknown', () => {
    const state = createShinsaState({ repos: [createRepo({ id: 'r1', name: 'shinsa' })] });
    expect(resolveRepoName(state, createTask({ id: 't1', repoId: 'r1' }))).toBe('shinsa');
    expect(resolveRepoName(state, createTask({ id: 't1', repoId: 'gone' }))).toBe('');
    expect(resolveRepoName(state, createTask({ id: 't1' }))).toBe('');
  });
});

describe('keywords', () => {
  it('matches a command by label first, then hint and keywords', () => {
    expect(
      listCommandKeywords(runCommand('a', { label: 'Merge #42', hint: 'Fix login', keywords: ['ship'] }))
    ).toEqual(['Merge #42', 'Fix login', 'ship']);
    expect(listCommandKeywords(runCommand('a', { label: 'Home' }))).toEqual(['Home', '']);
  });

  it('matches a choice option by its label, the choice and its own keywords', () => {
    const command = choice('dark');
    const [system, dark] = command.options;
    if (!system || !dark) throw new Error('Expected two options');
    expect(listOptionKeywords(command, dark)).toEqual(['Dark', 'Theme', 'Change theme…', 'night']);
    expect(listOptionKeywords(command, system)).toEqual(['System', 'Theme', 'Change theme…']);
  });

  it('matches a task by title, handle, repository, branch, status and intent', () => {
    const task = createTask({
      id: 't1',
      title: 'Fix login',
      handle: 'SW-142',
      repoId: 'r1',
      branch: 'fix/login',
      request: 'x'.repeat(300),
    });
    const state = createShinsaState({ tasks: [task], repos: [createRepo({ id: 'r1', name: 'web' })] });
    expect(listTaskKeywords(state, task)).toEqual([
      'Fix login',
      'SW-142',
      'web',
      'fix/login',
      resolveTaskStatus(state, task).label,
      'x'.repeat(200),
    ]);
    const bare = listTaskKeywords(state, createTask({ id: 't2' }));
    expect([bare[1], bare[3]]).toEqual(['', '']);
  });
});

describe('listMenuTasks', () => {
  it('lists open tasks before finished ones, most recently updated first', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'old', updatedAt: 1 }),
        createTask({ id: 'merged', stage: 'merged', updatedAt: 9 }),
        createTask({ id: 'new', updatedAt: 5 }),
        createTask({ id: 'cancelled', stage: 'cancelled', updatedAt: 2 }),
        createTask({ id: 'home', stage: 'watching', watchHome: true, updatedAt: 10 }),
      ],
    });
    expect(listMenuTasks(state).map((task) => task.id)).toEqual(['new', 'old', 'merged', 'cancelled']);
  });

  it('keeps the list to 300 tasks', () => {
    const tasks = Array.from({ length: 305 }, (_, index) =>
      createTask({ id: `t${index}`, updatedAt: index })
    );
    const listed = listMenuTasks(createShinsaState({ tasks }));
    expect(listed).toHaveLength(300);
    expect(listed[0]?.id).toBe('t304');
  });
});

describe('resolveFirstValue', () => {
  it('highlights the submit row on a compose page', () => {
    const frame = {
      kind: 'compose' as const,
      crumb: 'Answer',
      placeholder: '',
      submit: 'Send',
      send: async () => {},
    };
    expect(resolveFirstValue(frame, [])).toBe('compose.submit');
  });

  it('highlights the first task on the task list, or nothing when there is none', () => {
    expect(resolveFirstValue(TASKS_FRAME, [createTask({ id: 't1' })])).toBe('jump:t1');
    expect(resolveFirstValue(TASKS_FRAME, [])).toBe('');
  });

  it('opens a choice on its current value', () => {
    expect(resolveFirstValue({ kind: 'choice', command: choice('dark') }, [])).toBe('appearance.theme:dark');
    expect(resolveFirstValue({ kind: 'choice', command: choice(['dark', 'system']) }, [])).toBe(
      'appearance.theme:system'
    );
  });

  it('falls back to the first option, or nothing for an empty choice', () => {
    expect(resolveFirstValue({ kind: 'choice', command: choice(null) }, [])).toBe('appearance.theme:system');
    expect(resolveFirstValue({ kind: 'choice', command: { ...choice(null), options: [] } }, [])).toBe('');
  });

  it('never opens a choice on a disabled option, even the current one', () => {
    const held = choice('dark');
    const options = [{ ...held.options[0], disabled: 'Not here' } as ChoiceOption, ...held.options.slice(1)];
    expect(resolveFirstValue({ kind: 'choice', command: { ...held, value: null, options } }, [])).toBe(
      'appearance.theme:dark'
    );
    const locked = options.map((option) => ({ ...option, disabled: 'Not here' }));
    expect(resolveFirstValue({ kind: 'choice', command: { ...held, options: locked } }, [])).toBe('');
    const current = [
      held.options[0] as ChoiceOption,
      { ...held.options[1], disabled: 'Not here' } as ChoiceOption,
    ];
    expect(resolveFirstValue({ kind: 'choice', command: { ...held, options: current } }, [])).toBe(
      'appearance.theme:system'
    );
  });

  it('highlights the first enabled, visible command of the best ranked section', () => {
    const frame = list([
      { id: 'late', heading: 'Late', rank: 50, commands: [runCommand('late.first')] },
      {
        id: 'early',
        heading: 'Early',
        rank: 0,
        commands: [
          runCommand('early.disabled', { disabled: 'Not ready yet' }),
          runCommand('early.typing', { searchOnly: true }),
          runCommand('early.first'),
        ],
      },
    ]);
    expect(resolveFirstValue(frame, [])).toBe('early.first');
    expect(resolveFirstValue(list([]), [])).toBe('');
  });
});

describe('resolveCrumb', () => {
  it('names each kind of page', () => {
    expect(resolveCrumb(TASKS_FRAME)).toBe('Tasks');
    expect(resolveCrumb({ kind: 'choice', command: choice('dark') })).toBe('Theme');
    expect(resolveCrumb(list([]))).toBe('Cancel task');
  });
});

describe('resolvePlaceholder', () => {
  it('talks about the task on a task page and about everything elsewhere', () => {
    expect(resolvePlaceholder(undefined, { name: 'task', reference: 't1' })).toBe(
      'Act on this task, jump to another, or type a new one…'
    );
    expect(resolvePlaceholder(undefined, { name: 'home' })).toBe(
      'Search tasks and actions, or describe a new task…'
    );
  });

  it('uses the page, the choice label or the task list', () => {
    expect(resolvePlaceholder(TASKS_FRAME, { name: 'home' })).toBe('Jump to a task…');
    expect(resolvePlaceholder({ kind: 'choice', command: choice('dark') }, { name: 'home' })).toBe(
      'Change theme…'
    );
    expect(
      resolvePlaceholder(
        { kind: 'choice', command: { ...choice('dark'), label: 'Set priority' } },
        { name: 'home' }
      )
    ).toBe('Set priority…');
    expect(resolvePlaceholder(list([]), { name: 'home' })).toBe('Cancel this task?');
  });
});

describe('listListedTaskIds', () => {
  it('collects the tasks that go rows already open', () => {
    const sections: CommandSection[] = [
      {
        id: 'needs',
        heading: 'Needs you',
        rank: 0,
        commands: [
          { kind: 'go', id: 'home.task.a', label: 'A', to: '/tasks/a', taskId: 'a' },
          { kind: 'go', id: 'go.home', label: 'Home', to: '/' },
          runCommand('task.b.restart', { taskId: 'b' }),
        ],
      },
    ];
    expect([...listListedTaskIds(sections)]).toEqual(['a']);
  });
});

describe('listRecentTasks', () => {
  const state = createShinsaState({
    tasks: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id) => createTask({ id })),
  });

  it('lists recent tasks except the current one, listed ones and unknown ids, up to five', () => {
    const recent = listRecentTasks(
      state,
      ['gone', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
      'a',
      new Set(['c']),
      NOW
    );
    expect(recent.map((task: Task) => task.id)).toEqual(['b', 'd', 'e', 'f', 'g']);
  });

  it('lists nothing without recent visits', () => {
    expect(listRecentTasks(state, [], null, new Set(), NOW)).toEqual([]);
  });

  it('leaves out tasks outside the focus project while the focus lasts', () => {
    const focused = createShinsaState({
      repos: [createRepo({ id: 'api', projectId: 'work' }), createRepo({ id: 'garden', projectId: 'home' })],
      tasks: [createTask({ id: 'login', repoId: 'api' }), createTask({ id: 'beds', repoId: 'garden' })],
      patch: { focus: { projectId: 'work', until: NOW + 1000 } },
    });
    const ids = (now: number) =>
      listRecentTasks(focused, ['beds', 'login'], null, new Set(), now).map((task: Task) => task.id);
    expect(ids(NOW)).toEqual(['login']);
    expect(ids(NOW + 1000)).toEqual(['beds', 'login']);
  });
});

describe('listDecisionCommands', () => {
  function decisions() {
    const tasks = [
      createTask({ id: 'a', title: 'Fix login', pullRequest: { number: 7 } as Task['pullRequest'] }),
      createTask({ id: 'b', title: 'Add search' }),
      createTask({ id: 'c', title: 'Quiet' }),
    ];
    const gates = [
      createGate({ id: 'ga', taskId: 'a', type: 'merge', openedAt: 1 }),
      createGate({ id: 'ga2', taskId: 'a', type: 'failure', openedAt: 2 }),
      createGate({ id: 'gb', taskId: 'b', type: 'plan', openedAt: 3 }),
    ];
    return createShinsaState({ tasks, gates });
  }

  it('offers the decisions of every task in the queue, named for their task', () => {
    const commands = listDecisionCommands(decisions(), null, []);
    expect(commands.map((command) => [command.id, command.label, command.hint, command.taskId])).toEqual([
      ['queue:task.a.gate.ga2.retry', 'Retry', 'Fix login', 'a'],
      ['queue:task.a.gate.ga2.guide', 'Retry with guidance', 'Fix login', 'a'],
      ['queue:task.a.gate.ga.merge', 'Merge #7', 'Fix login', 'a'],
      ['queue:task.a.gate.ga.revise', 'Request changes', 'Fix login', 'a'],
      ['queue:task.b.gate.gb.approve', 'Approve the plan', 'Add search', 'b'],
      ['queue:task.b.gate.gb.revise', 'Revise the plan', 'Add search', 'b'],
    ]);
  });

  it('leaves out the current task and commands a page already registered', () => {
    const registered: CommandSection[] = [
      { id: 'page', heading: 'Page', rank: 0, commands: [runCommand('task.b.gate.gb.approve')] },
    ];
    expect(listDecisionCommands(decisions(), 'a', registered).map((command) => command.id)).toEqual([
      'queue:task.b.gate.gb.revise',
    ]);
  });

  it('sends Request changes from the queue without draft comments', async () => {
    const spies = spyOnCommands();
    const revise = listDecisionCommands(decisions(), null, []).find(
      (command) => command.id === 'queue:task.a.gate.ga.revise'
    );
    if (revise?.kind !== 'page' || revise.page.kind !== 'compose') throw new Error('Expected a compose page');
    await revise.page.send('Rebase first');
    expect(spies.sent.mock.calls).toEqual([
      [
        { type: 'gate.answer', gateId: 'ga', decision: 'revise', response: 'Rebase first' },
        'Sent back to the agent.',
      ],
    ] as never);
    spies.restore();
  });

  it('offers nothing when nothing needs you', () => {
    expect(listDecisionCommands(createShinsaState({ tasks: [createTask({ id: 'a' })] }), null, [])).toEqual(
      []
    );
  });
});

describe('listChoiceCommands and listSearchCommands', () => {
  it('picks out the choices and the searches across sections', () => {
    const theme = choice('dark');
    const search: Command = {
      kind: 'search',
      id: 'tasks.search',
      label: 'Search all tasks',
      search: () => {},
    };
    const sections: CommandSection[] = [
      { id: 'one', heading: 'One', rank: 0, commands: [runCommand('a'), theme] },
      { id: 'two', heading: 'Two', rank: 1, commands: [search] },
    ];
    expect(listChoiceCommands(sections)).toEqual([theme]);
    expect(listSearchCommands(sections)).toEqual([search]);
  });
});

describe('isCommandShown', () => {
  it('hides search rows always and searchOnly rows until you type', () => {
    expect(isCommandShown(runCommand('a'), false)).toBe(true);
    expect(isCommandShown(runCommand('a', { searchOnly: true }), false)).toBe(false);
    expect(isCommandShown(runCommand('a', { searchOnly: true }), true)).toBe(true);
    expect(isCommandShown({ kind: 'search', id: 's', label: 'Search', search: () => {} }, true)).toBe(false);
  });
});

describe('arrangeByScore', () => {
  const blocks = [
    { id: 'a', score: 0.5 },
    { id: 'b', score: 0.9 },
    { id: 'c', score: 0.5 },
    { id: 'd', score: 1 },
  ];

  it('keeps the given order with an empty query', () => {
    expect(arrangeByScore(blocks, false)).toBe(blocks);
  });

  it('orders groups by their best match, keeping ties in place', () => {
    expect(arrangeByScore(blocks, true).map((block) => block.id)).toEqual(['d', 'b', 'a', 'c']);
    expect(blocks.map((block) => block.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('listSectionBlocks', () => {
  const sections: CommandSection[] = [
    { id: 'quiet', heading: 'Quiet', rank: 0, commands: [runCommand('hidden', { searchOnly: true })] },
    { id: 'task', heading: 'Task', rank: 0, commands: [runCommand('task.cancel', { label: 'Cancel task' })] },
  ];

  it('leaves out a section with nothing to show until you type', () => {
    expect(listSectionBlocks(sections, '').map((block) => block.key)).toEqual(['task']);
    expect(listSectionBlocks(sections, 'hidden').map((block) => block.key)).toEqual(['quiet', 'task']);
  });

  it('scores a section by its best command', () => {
    const [quiet, task] = listSectionBlocks(sections, 'cancel');
    expect(task?.score ?? 0).toBeGreaterThan(quiet?.score ?? 0);
  });

  it('scores a section by its best enabled command, so a disabled match never ranks it first', () => {
    const held: CommandSection[] = [
      {
        id: 'held',
        heading: 'Held',
        rank: 0,
        commands: [runCommand('held.cancel', { label: 'Cancel task', disabled: 'Not now' })],
      },
    ];
    expect(listSectionBlocks(held, 'cancel')[0]?.score).toBe(0);
  });
});

describe('listRootBlocks', () => {
  const state = createShinsaState({
    tasks: [
      createTask({ id: 'login', title: 'Fix the login redirect', stage: 'reviewing', updatedAt: 3 }),
      createTask({ id: 'billing', title: 'Rework billing emails', updatedAt: 2 }),
    ],
    gates: [createGate({ id: 'g1', taskId: 'login', type: 'review' })],
  });
  const search: Command = { kind: 'search', id: 'tasks.search', label: 'Search all tasks', search: () => {} };
  const sections: CommandSection[] = [
    { id: 'page', heading: 'This page', rank: RANK.page, commands: [runCommand('page.refresh')] },
    { id: 'appearance', heading: 'Appearance', rank: RANK.global, commands: [choice('dark'), search] },
  ];
  const keys = (blocks: MenuBlock[]) => blocks.map((block) => block.key);
  const root = (query: string, recent: string[] = []) =>
    listRootBlocks({ state, sections, registered: [], recent, currentTaskId: null, query, now: NOW });

  it('puts the page’s sections, Recent and Tasks before the global sections while the query is empty', () => {
    expect(keys(root('', ['billing']))).toEqual(['page', 'recent', 'tasks', 'appearance']);
    expect(root('').find((block) => block.kind === 'tasks')).toMatchObject({ tasks: [], total: 2 });
  });

  it('adds decisions, matching tasks, choices, searches and New task once you type, best match first', () => {
    const blocks = root('dark');
    expect(keys(blocks)[0]).toBe('appearance.theme');
    expect(keys(blocks)).toEqual(expect.arrayContaining(['decisions', 'tasks', 'search', 'new-task']));
    expect(keys(blocks)).not.toContain('recent');
    const tasks = blocks.find((block) => block.kind === 'tasks');
    expect(tasks?.kind === 'tasks' && tasks.tasks.map((task) => task.id)).toEqual(['login', 'billing']);
  });

  it('ranks a choice by its enabled options only', () => {
    const theme = choice('dark');
    const held = { ...theme, options: theme.options.map((option) => ({ ...option, disabled: 'Not here' })) };
    const blocks = listRootBlocks({
      state,
      sections: [{ id: 'appearance', heading: 'Appearance', rank: RANK.global, commands: [held] }],
      registered: [],
      recent: [],
      currentTaskId: null,
      query: 'dark',
      now: NOW,
    });
    expect(blocks.find((block) => block.key === 'appearance.theme')?.score).toBe(0);
    expect(keys(root('dark'))[0]).toBe('appearance.theme');
  });

  it('leaves out the search block when no section offers a search', () => {
    const blocks = listRootBlocks({
      state,
      sections: [sections[0] as CommandSection],
      registered: [],
      recent: [],
      currentTaskId: null,
      query: 'refresh',
      now: NOW,
    });
    expect(keys(blocks)).toEqual(['page', 'decisions', 'tasks', 'new-task']);
  });
});

describe('New task', () => {
  it('goes Home and asks the composer for an empty draft, or the one you typed', () => {
    const drafts: string[] = [];
    act(() => navigate('/tasks'));
    NEW_TASK_COMMAND.run();
    renderHook(() => useNewTaskRequest((draft) => drafts.push(draft)));
    expect(location.pathname).toBe('/');
    act(() => navigate('/settings'));
    act(() => requestNewTaskOnHome('Add tests'));
    expect(location.pathname).toBe('/');
    expect(drafts).toEqual(['', 'Add tests']);
  });
});
