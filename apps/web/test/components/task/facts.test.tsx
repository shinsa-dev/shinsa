import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import type { Task, TriageDecisions } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TaskFacts } from '@/components/task/facts.tsx';
import { connection, type MachineChoice, replaceConnection } from '@/lib/connection/socket.ts';
import { TONE_TEXT } from '@/lib/format/tone.ts';
import { createAccount, createSnapshot } from '../../support/accounts.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createPartialCoverage } from '../../support/coverage.ts';
import { findTooltipText } from '../../support/hover.ts';
import { createPullRequest } from '../../support/pull-request.ts';
import { createMachineResources, createTaskResources } from '../../support/resources.ts';
import { createRound } from '../../support/rounds.ts';
import {
  listSentCommands,
  pushAccounts,
  pushState,
  pushTeams,
  startFakeServer,
  stopFakeServer,
} from '../../support/server.ts';
import { createProject, createRepo, createRun, createShinsaState, createTask } from '../../support/state.ts';

const DECIDED: TriageDecisions = {
  shape: { value: 'answer', why: 'It asks how something works.' },
  start: null,
  priority: { value: 'normal', why: 'Nothing is waiting on it.' },
};

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  startFakeServer();
  toasts = spyOnToasts();
  pushAccounts(
    createSnapshot({
      accounts: [
        createAccount({ id: 'a' }),
        createAccount({ id: 'b' }),
        createAccount({ id: 'c', signIn: 'signed_out' }),
      ],
    })
  );
});

afterEach(() => {
  toasts.restore();
  stopFakeServer();
});

function renderFacts(task: Task = createTask({ id: 't', handle: 'SW-7' }), others: Task[] = []) {
  const state = createShinsaState({ tasks: [task, ...others] });
  pushState(state);
  return render(
    <TooltipProvider>
      <TaskFacts state={state} task={task} />
    </TooltipProvider>
  );
}

describe('a task with no repository', () => {
  it('shows no repository fact, where a task with one names it', () => {
    const question = createTask({ id: 'hey', handle: 'T-1', stage: 'answering', pipeline: ['answer'] });
    const state = createShinsaState({
      tasks: [question, { ...question, id: 'bound', repoId: 'kanna' }],
      repos: [createRepo({ id: 'kanna' })],
    });
    pushState(state);
    const view = render(
      <TooltipProvider>
        <TaskFacts state={state} task={question} />
        <hr />
        <TaskFacts state={state} task={state.tasks.bound as Task} />
      </TooltipProvider>
    );
    const [unbound, bound] = view.container.querySelectorAll('div.flex-wrap');
    expect(unbound?.textContent).not.toMatch(/kanna|repositor/i);
    expect(bound?.textContent).toContain('kanna');
  });

  it('marks the repository with a folder in its project’s colour, and a plain folder without a project', () => {
    const task = createTask({ id: 'web', handle: 'SW-1', repoId: 'web' });
    const state = createShinsaState({
      tasks: [task, { ...task, id: 'loose', repoId: 'scratch' }],
      projects: [createProject({ id: 'p', name: 'Superwall', color: 'purple' })],
      repos: [
        createRepo({
          id: 'web',
          name: 'paywall-next',
          projectId: 'p',
          remote: 'git@github.com:sw/paywall-next.git',
        }),
        createRepo({ id: 'scratch', name: 'scratch' }),
      ],
    });
    pushState(state);
    const view = render(
      <TooltipProvider>
        <TaskFacts state={state} task={task} />
        <TaskFacts state={state} task={state.tasks.loose as Task} />
      </TooltipProvider>
    );
    const [bound, loose] = view.container.querySelectorAll('div.flex-wrap');
    const ink = bound?.querySelector('[data-project-ink]') as SVGElement | null;
    expect(ink?.getAttribute('data-project-ink')).toBe('purple');
    expect(ink?.style.getPropertyValue('--icon-color')).toBe('var(--purple-4, var(--fg-2))');
    expect(bound?.textContent).toContain('paywall-next');
    expect(bound?.textContent).not.toContain('Superwall');
    expect(loose?.textContent).toContain('scratch');
    expect(loose?.querySelector('[data-project-ink]')).toBeNull();
  });
});

describe('the handle fact', () => {
  it('copies the handle and says “Copied” in a toast', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    renderFacts();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy SW-7' }));
    });
    expect(write).toHaveBeenCalledWith('SW-7');
    expect(toasts.success).toHaveBeenCalledWith('Copied');
    write.mockRestore();
  });

  it('says it could not copy when the clipboard refuses', async () => {
    const write = spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    renderFacts();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy SW-7' }));
    });
    expect(toasts.success).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith('Couldn’t copy to the clipboard');
    write.mockRestore();
  });
});

describe('what Shinsa decided, in the facts', () => {
  function decided(overrides: Partial<Task> = {}) {
    return createTask({
      id: 't',
      stage: 'answering',
      pipeline: ['answer'],
      triageDecisions: DECIDED,
      ...overrides,
    });
  }

  it('leaves the kind of task out: the task itself shows it', () => {
    const view = renderFacts(decided());
    expect(view.queryByText('Answer only')).toBeNull();
    expect(view.getByText('Answering')).toBeTruthy();
  });

  it('gives the priority Shinsa’s reason, and changes it in one click', async () => {
    const view = renderFacts(decided());
    const priority = view.getByRole('button', { name: 'Normal' });
    expect(await findTooltipText(priority)).toBe('Shinsa chose this: Nothing is waiting on it.');
    fireEvent.click(priority);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Urgent' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.prioritize', taskId: 't', priority: 'urgent' }])
    );
  });

  it('reads a fact you changed as yours', async () => {
    const view = renderFacts(decided({ stage: 'building', pipeline: undefined, priority: 'high' }));
    expect(await findTooltipText(view.getByRole('button', { name: 'High' }))).toBe(
      'You changed this. Shinsa chose “normal priority”: Nothing is waiting on it.'
    );
  });

  it('puts why a task waits on its Waits on fact, which starts it now', async () => {
    const base = createTask({ id: 'base', title: 'Fix the schema' });
    const task = decided({
      stage: 'waiting_on_tasks',
      waitsOn: ['base'],
      triageDecisions: { ...DECIDED, start: { value: ['base'], why: 'It reads the same table.' } },
    });
    const view = renderFacts(task, [base]);
    const waits = view.getByRole('button', { name: 'Waits on Fix the schema' });
    expect(await findTooltipText(waits)).toBe('Shinsa chose this: It reads the same table.');
    fireEvent.click(waits);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Stop waiting' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'task.wait_on', taskId: 't', waitsOn: [] }])
    );
  });

  it('puts why a task started at once on when it started', async () => {
    const task = decided({
      triageDecisions: { ...DECIDED, start: { value: [], why: 'Nothing it reads is changing.' } },
    });
    const view = renderFacts(task);
    expect(await findTooltipText(view.getByText(/^Started/))).toContain(
      'Shinsa chose this: Nothing it reads is changing.'
    );
  });
});

describe('the Account fact', () => {
  it('names the account a finished task ran on without offering to move it', () => {
    renderFacts(
      createTask({ id: 't', stage: 'merged', branch: 'feat/x', account: { id: 'a', email: 'a@example.com' } })
    );
    expect(screen.getByText('Runs on a@example.com')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Runs on a@example.com' })).toBeNull();
  });

  it('says which account a bound task runs on and rebinds it', async () => {
    renderFacts(createTask({ id: 't', account: { id: 'a', email: 'a@example.com' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Runs on a@example.com' }));
    const items = await screen.findAllByRole('menuitemradio');
    expect(items.map((item) => [item.textContent, item.getAttribute('aria-checked')])).toEqual([
      ['Any account', 'false'],
      ['a@example.com', 'true'],
      ['b@example.com', 'false'],
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'b@example.com' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'task.bind_account', taskId: 't', account: { id: 'b', email: 'b@example.com' } },
      ])
    );
  });

  it('is left out for a task that runs on any account', () => {
    renderFacts(createTask({ id: 't' }));
    expect(screen.queryByRole('button', { name: /^Runs on/ })).toBeNull();
  });
});

describe('the machine in the facts row', () => {
  function renderOnMachine(resources: MachineChoice['resources']) {
    const local = connection;
    const task = createTask({ id: 't', handle: 'SW-7' });
    const state = createShinsaState({ tasks: [task] });
    const machine: MachineChoice = { id: 'k3x9', name: 'Studio', current: false, state, resources };
    const view = { id: machine.id, name: machine.name, current: false };
    const machines = [machine];
    replaceConnection({ ...local, selectMachine: () => view, listMachines: () => machines });
    render(
      <TooltipProvider>
        <TaskFacts state={state} task={task} />
      </TooltipProvider>
    );
    return screen.getByRole('button', { name: 'Studio' });
  }

  async function openCard(trigger: HTMLElement) {
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    return waitFor(() => {
      const card = document.querySelector('[data-slot="preview-card-content"]');
      if (!card?.textContent) throw new Error('No card is open.');
      return card.textContent;
    });
  }

  afterEach(() => replaceConnection(null));

  it('opens a card with the machine’s numbers and what the task uses there', async () => {
    const fact = renderOnMachine(
      createMachineResources({
        tasks: [createTaskResources({ taskId: 't', checks: { cpuPercent: 30, memoryBytes: 1024 ** 3 } })],
      })
    );
    expect(await openCard(fact)).toBe(
      'StudioCPU 20% · Memory 8 of 32 GB · 120 GB freeWhat this task usesAgent4% · 0.5 GBServicesIdleChecks30% · 1 GBWorktree2 GB'
    );
  });

  it('only names the machine while it has sent no reading', async () => {
    expect(await openCard(renderOnMachine(null))).toBe('StudioThe machine this task runs on');
  });
});

describe('the round and the agents in the facts row', () => {
  it('names the current round with one icon and, on hover, its title, how it stands and when it started', async () => {
    const task = createTask({
      id: 't',
      handle: 'SW-7',
      rounds: [
        createRound({ number: 1, status: 'finished' }),
        createRound({ number: 2, title: 'Explain what it can do', status: 'active', outcome: null }),
      ],
    });
    renderFacts(task);
    const round = screen.getByText('Round 2 of 2');
    expect(screen.getByRole('button', { name: 'Copy SW-7' }).textContent).toBe('SW-7');
    expect(await findTooltipText(round)).toMatch(/^Round 2: Explain what it can doIn progressStarted /);
  });

  it('lists who worked on the task, each role once and its delegated agents under it, opening the chat', async () => {
    const task = createTask({ id: 't', handle: 'SW-7' });
    const state = createShinsaState({
      tasks: [task],
      runs: [
        createRun({ id: 'a', taskId: 't', role: 'answerer', startedAt: 1, endedAt: 2, outcome: 'completed' }),
        createRun({ id: 'b', taskId: 't', role: 'answerer', startedAt: 3 }),
      ],
    });
    pushState(state);
    render(
      <TooltipProvider>
        <TaskFacts state={state} task={task} />
      </TooltipProvider>
    );
    const trigger = screen.getByRole('button', { name: /1 agent/ });
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    const list = await screen.findByRole('list', { name: 'Who worked on this' });
    expect(list.textContent).toBe('Answerer2 runs · working now');
    fireEvent.click(screen.getByRole('button', { name: /Answerer/ }));
    expect(window.location.pathname + window.location.search).toBe('/tasks/SW-7?tab=chat&run=b');
  });
});

describe('the cost fact', () => {
  it('shows its icon and value in the row and the breakdown in its popover, the one place a task’s cost shows', async () => {
    const task = createTask({ id: 't', handle: 'SW-7' });
    const usage = {
      inputTokens: 2_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 3,
    };
    const state = createShinsaState({
      tasks: [task],
      runs: [createRun({ id: 'k', taskId: 't', role: 'answerer', usage })],
    });
    pushState(state);
    render(
      <TooltipProvider>
        <TaskFacts state={state} task={task} />
      </TooltipProvider>
    );
    const trigger = screen.getByRole('button', { name: '$3.00' });
    expect(trigger.textContent).toBe('$3.00');
    expect(screen.queryByText('By step')).toBeNull();
    await act(async () => {
      fireEvent.pointerEnter(trigger);
      fireEvent.mouseEnter(trigger);
      fireEvent.pointerMove(trigger);
      fireEvent.mouseMove(trigger);
    });
    expect(await screen.findByText('By step')).toBeTruthy();
    expect(screen.getAllByText('$3.00').length).toBeGreaterThan(1);
  });
});

describe('the coverage fact', () => {
  it('says how much of the change the tests run and links to How to test in Review', async () => {
    renderFacts(createTask({ id: 't', handle: 'SW-7', coverage: createPartialCoverage() }));
    const fact = screen.getByText('85% of changed lines covered').closest('a') as HTMLAnchorElement;
    expect(fact.getAttribute('href')).toBe('/tasks/SW-7?tab=review&spot=testing');
    expect(await findTooltipText(fact)).toBe(
      '85% of changed lines are covered (36 of 42) · 2 files have uncovered lines. How to test in Review lists the files.'
    );
  });

  it('shows nothing when coverage was not measured', () => {
    renderFacts(
      createTask({
        id: 't',
        handle: 'SW-7',
        coverage: { status: 'unavailable', command: 'bun test', reason: 'No report.' },
      })
    );
    expect(screen.queryByText(/changed lines/)).toBeNull();
  });
});

describe('the checks fact', () => {
  const checks = [
    { id: 'c1', label: 'Unit tests', command: 'bun test a.test.ts', phases: [1], source: 'plan' as const },
    { id: 'c2', label: 'Types', command: 'bun run check-types', phases: [1], source: 'agent' as const },
  ];

  it('sums up the checks before the pull request, and leaves them to the pull request’s fact after it', () => {
    const view = renderFacts(
      createTask({
        id: 't',
        handle: 'SW-7',
        checks,
        checkResults: [
          { id: 'c1', label: 'Unit tests', command: 'bun test a.test.ts', outcome: 'pass', detail: null },
          { id: 'c2', label: 'Types', command: 'bun run check-types', outcome: 'fail', detail: null },
        ],
      })
    );
    expect(screen.getByText('1 of 2 checks passed')).toBeTruthy();
    view.unmount();
    renderFacts(
      createTask({
        id: 't',
        handle: 'SW-7',
        checks,
        stage: 'checking',
        stageReason: 'running the checks before review',
        pullRequest: createPullRequest({ number: 9 }),
      })
    );
    expect(screen.getByText('#9')).toBeTruthy();
    expect(screen.queryByText(/checks? passed|Running/)).toBeNull();
  });
});

describe('the pull request fact', () => {
  it('colours the number in the pull request’s tone, red while its checks fail', () => {
    const view = renderFacts(
      createTask({
        id: 't',
        handle: 'SW-7',
        pullRequest: createPullRequest({ number: 43, checks: 'failing' }),
      })
    );
    expect(screen.getByText('#43').className).toContain(TONE_TEXT.red);
    view.unmount();
    renderFacts(createTask({ id: 't', handle: 'SW-7', pullRequest: createPullRequest({ number: 43 }) }));
    expect(screen.getByText('#43').className).toContain(TONE_TEXT.green);
  });
});

describe('the related task facts', () => {
  it('reads each verb and its count or title with one plain space between them', () => {
    const task = createTask({ id: 't', handle: 'SW-7' });
    const view = renderFacts(task, [
      createTask({ id: 'd1', waitsOn: ['t'] }),
      createTask({ id: 'd2', waitsOn: ['t'] }),
      createTask({ id: 'f1', title: 'Fix the schema', forkOf: 't' }),
    ]);
    const texts = view.getAllByRole('button').map((button) => button.textContent);
    expect(texts).toContain('Unblocks 2 tasks');
    expect(texts).toContain('Forked into Fix the schema');
  });

  it('reads Waits on and the titles it waits on with one plain space between them', () => {
    const base = createTask({ id: 'base', title: 'Fix the schema' });
    const view = renderFacts(createTask({ id: 't', stage: 'waiting_on_tasks', waitsOn: ['base'] }), [base]);
    expect(view.getAllByRole('button').map((button) => button.textContent)).toContain(
      'Waits on Fix the schema'
    );
  });
});

describe('a duplicate', () => {
  it('links the task it duplicates and says why Shinsa closed it', async () => {
    const original = createTask({ id: 'o', handle: 'SW-1', title: 'Add dark mode' });
    const copy = createTask({
      id: 'c',
      handle: 'SW-3',
      stage: 'cancelled',
      duplicate: { of: 'o', by: 'shinsa', why: 'Both ask for a dark theme.' },
    });
    renderFacts(copy, [original]);
    expect(screen.getByText('Duplicate')).toBeTruthy();
    const link = screen.getByRole('button', { name: /Duplicate of SW-1 Add dark mode/ });
    expect(await findTooltipText(link)).toBe('Shinsa closed this as a duplicate: Both ask for a dark theme.');
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/tasks/SW-1');
  });

  it('names a teammate’s original by first name with their user card and opens its read-only team view', async () => {
    const copy = createTask({
      id: 'c',
      handle: 'SW-3',
      stage: 'cancelled',
      duplicate: {
        of: 'kai-task',
        by: 'shinsa',
        why: null,
        teammate: {
          teamId: 'core',
          machineId: 'kai',
          taskId: 'kai-task',
          handle: 'KAI-12',
          title: 'Add dark mode',
          owner: { login: 'kai', name: 'Kai Tanaka', avatarUrl: null },
        },
      },
    });
    renderFacts(copy);
    expect(screen.getByText('Duplicate of')).toBeTruthy();
    const owner = screen.getByRole('link', { name: /Kai’s/ });
    expect(owner.getAttribute('href')).toBe('https://github.com/kai');
    expect(screen.queryByText(/@kai/)).toBeNull();
    const link = screen.getByRole('button', { name: 'KAI-12 Add dark mode' });
    expect(await findTooltipText(link)).toBe(
      'Shinsa closed this as a duplicate of a teammate’s task, which you can only view.'
    );
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/teams/core/kai/kai-task');
  });

  it('shows on a teammate’s original which of your tasks was closed in favour of it', async () => {
    const original = createTask({ id: 'kai-task', handle: 'KAI-12', title: 'Add dark mode' });
    const copy = createTask({
      id: 'c',
      handle: 'SW-3',
      title: 'Dark theme please',
      stage: 'cancelled',
      duplicate: {
        of: 'kai-task',
        by: 'shinsa',
        why: null,
        teammate: {
          teamId: 'core',
          machineId: 'kai',
          taskId: 'kai-task',
          handle: 'KAI-12',
          title: 'Add dark mode',
          owner: null,
        },
      },
    });
    renderFacts(original);
    pushTeams({
      machines: [],
      tasks: [
        {
          task: copy,
          gates: [],
          project: null,
          repo: null,
          owner: 'christo',
          ownerProfile: { name: 'Christo Todorov', avatarUrl: null },
          machine: 'Studio',
          teamId: 'core',
          instanceId: 'studio',
        },
      ],
    });
    const link = await screen.findByRole('button', { name: 'SW-3 Dark theme please' });
    expect(screen.getByText('Kept over')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Christo’s/ })).toBeTruthy();
    fireEvent.click(link);
    expect(window.location.pathname).toBe('/teams/core/studio/c');
  });

  it('shows on the task it duplicates which task was closed in favour of it', () => {
    const original = createTask({ id: 'o', handle: 'SW-1', title: 'Add dark mode' });
    const copy = createTask({
      id: 'c',
      handle: 'SW-3',
      title: 'Dark theme please',
      stage: 'cancelled',
      duplicate: { of: 'o', by: 'shinsa', why: null },
    });
    renderFacts(original, [copy]);
    fireEvent.click(screen.getByRole('button', { name: 'Kept over Dark theme please' }));
    expect(window.location.pathname).toBe('/tasks/SW-3');
  });
});
