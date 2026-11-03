import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { connection } from '@/lib/connection/socket.ts';
import { HomePage } from '@/routes/home.tsx';
import { TasksPage } from '@/routes/tasks.tsx';
import { createTeamFeedTask } from '../../lib/teams/machine.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { pushTeams, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createRepo, createShinsaState, createTask } from '../../support/state.ts';
import { createTeamEntry } from '../../support/teams.ts';

const TASKS = [
  createTask({ id: 'mine', title: 'My own task', stage: 'building', projectId: 'shared' }),
  createTask({ id: 'private', title: 'My private task', stage: 'building', projectId: 'solo' }),
];

const PROJECTS = [
  createProject({ id: 'shared', name: 'Shared', teamIds: ['team1'] }),
  createProject({ id: 'solo', name: 'Solo' }),
];

const FOCUSED = createShinsaState({
  tasks: TASKS,
  projects: PROJECTS,
  patch: { focus: { projectId: null, teamId: 'team1', until: null } },
});

const UNFOCUSED = createShinsaState({ tasks: TASKS, projects: PROJECTS });

const OPEN = createTeamFeedTask({
  task: createTask({
    id: 'kai-task',
    title: 'Add the billing page',
    handle: 'PL-3',
    repoId: 'r1',
    updatedAt: 10,
  }),
  repo: createRepo({ id: 'r1', name: 'paywalls' }),
});

const MERGED = createTeamFeedTask({
  task: createTask({ id: 'kai-merged', title: 'Ship the invoice export', stage: 'merged', updatedAt: 3 }),
});

beforeEach(() => {
  startFakeServer();
  visit('/tasks');
  act(() => connection.replaceRemote(createRemoteSnapshot({ teams: [createTeamEntry()] })));
  pushTeams({ machines: [], tasks: [OPEN, MERGED] });
});

afterEach(stopFakeServer);

function visit(path: string) {
  history.replaceState(null, '', path);
  dispatchEvent(new PopStateEvent('popstate'));
}

function renderTasks(state = FOCUSED) {
  return render(
    <TooltipProvider>
      <TasksPage state={state} />
    </TooltipProvider>
  );
}

describe('teammates’ tasks', () => {
  it('lists them on All tasks among your own, with an Owner column, and opens one read-only', () => {
    renderTasks();
    expect(screen.getByText('Owner')).toBeDefined();
    expect(screen.queryByText(/Teammates in/)).toBeNull();
    const working = screen.getByText('In progress').closest('section') as HTMLElement;
    expect(working.textContent).toContain('My own task');
    expect(working.textContent).toContain('Add the billing page');
    expect(working.textContent).toContain('paywalls');
    expect(within(working).getByRole('link', { name: 'kai' }).getAttribute('href')).toBe(
      'https://github.com/kai'
    );
    expect(within(working).getByText('You')).toBeDefined();
    fireEvent.click(screen.getByText('Add the billing page'));
    expect(location.pathname).toBe('/teams/team1/p7m2/kai-task');
  });

  it('shows each owner with their avatar in the Owner filter', async () => {
    renderTasks();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Filter' }));
      await Bun.sleep(0);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Owner' }));
      await Bun.sleep(0);
    });
    const kai = screen.getByRole('menuitemcheckbox', { name: /kai/ });
    expect(kai.querySelector('[aria-hidden]')?.textContent).toBe('K');
  });

  it('puts a finished one under Done, and follows the search and the status filter like your own', () => {
    visit('/tasks?status=done');
    const { unmount } = renderTasks();
    expect(screen.getByText('Ship the invoice export')).toBeDefined();
    expect(screen.queryByText('Add the billing page')).toBeNull();
    unmount();
    visit('/tasks?q=kai');
    renderTasks();
    expect(screen.getByText('Add the billing page')).toBeDefined();
    expect(screen.queryByText('My own task')).toBeNull();
  });

  it('leaves them off Home, which shows only your own tasks', () => {
    visit('/');
    render(
      <TooltipProvider>
        <HomePage state={FOCUSED} />
      </TooltipProvider>
    );
    expect(screen.queryByText('Add the billing page')).toBeNull();
    expect(screen.queryByText(/Teammates in/)).toBeNull();
  });

  it('marks the tasks of a machine that is offline, and drops the mark once it is back', () => {
    const offline = {
      teamId: 'team1',
      instanceId: 'p7m2',
      name: 'Studio',
      userId: '7',
      status: 'offline' as const,
      reason: 'Offline.',
      updatedAt: Date.now() - 2 * 60 * 60 * 1000,
    };
    pushTeams({ machines: [offline], tasks: [OPEN, MERGED] });
    renderTasks();
    expect(screen.getAllByText('Offline')).toHaveLength(1);
    pushTeams({ machines: [{ ...offline, status: 'live', reason: null }], tasks: [OPEN, MERGED] });
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('says why a teammate’s machine lists nothing, and drops the note once it is live', () => {
    const refused = {
      teamId: 'team1',
      instanceId: 'p7m2',
      name: 'Mac.lan',
      userId: '7',
      status: 'refused' as const,
      reason: 'That machine does not list you in this team yet.',
    };
    pushTeams({ machines: [refused], tasks: [] });
    renderTasks();
    const note = screen.getByRole('status');
    expect(note.textContent).toBe(
      'Mac.lan in Platform is not listing its tasks. That machine does not list you in this team yet.'
    );
    pushTeams({ machines: [{ ...refused, status: 'live', reason: null }], tasks: [] });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says when a teammate’s machine is offline and when it last listed its tasks', () => {
    pushTeams({
      machines: [
        {
          teamId: 'team1',
          instanceId: 'p7m2',
          name: 'Studio',
          userId: '7',
          status: 'offline',
          reason: 'Offline.',
          updatedAt: Date.now() - 2 * 60 * 60 * 1000,
        },
      ],
      tasks: [OPEN],
    });
    renderTasks();
    expect(screen.getByRole('status').textContent).toBe(
      'Studio in Platform is offline. Its tasks show as they were when it was last online. Updated 2h ago.'
    );
  });

  it('keeps your tasks outside the focused team off the list', () => {
    renderTasks();
    expect(screen.getByText('My own task')).toBeDefined();
    expect(screen.queryByText('My private task')).toBeNull();
  });

  it('lists every team’s tasks beside all of yours while nothing is in focus', () => {
    renderTasks(UNFOCUSED);
    expect(screen.getByText('My private task')).toBeDefined();
    expect(screen.getByText('Add the billing page')).toBeDefined();
    expect(screen.getByText('Owner')).toBeDefined();
  });

  it('lists only that project’s tasks, none of the team’s, while one of your projects is in focus', () => {
    renderTasks(
      createShinsaState({
        tasks: TASKS,
        projects: PROJECTS,
        patch: { focus: { projectId: 'solo', teamId: null, until: null } },
      })
    );
    expect(screen.getByText('My private task')).toBeDefined();
    expect(screen.queryByText('My own task')).toBeNull();
    expect(screen.queryByText('Add the billing page')).toBeNull();
  });

  it('keeps the default page width when teammates’ tasks are listed', () => {
    const { container } = renderTasks();
    expect(screen.getByText('Owner')).toBeDefined();
    const page = container.firstElementChild as HTMLElement;
    expect(page.className).toContain('max-w-3xl');
    expect(page.className).not.toContain('max-w-4xl');
  });

  it('shows no Owner column when you belong to no team', () => {
    act(() => connection.replaceRemote(createRemoteSnapshot({ teams: [] })));
    renderTasks(UNFOCUSED);
    expect(screen.getByText('My private task')).toBeDefined();
    expect(screen.queryByText('Owner')).toBeNull();
  });
});
