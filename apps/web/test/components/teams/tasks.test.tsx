import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useFocusedTeamTasks } from '@/components/teams/tasks.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { HomePage } from '@/routes/home.tsx';
import { TasksPage } from '@/routes/tasks.tsx';
import { createTeamFeedTask } from '../../lib/teams/machine.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { pushTeams, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createRepo, createShinsaState, createTask } from '../../support/state.ts';
import { createTeamEntry } from '../../support/teams.ts';

const FOCUSED = createShinsaState({
  tasks: [createTask({ id: 'mine', title: 'My own task', stage: 'building' })],
  patch: { focus: { projectId: null, teamId: 'team1', until: null } },
});

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

function renderTasks() {
  return render(
    <TooltipProvider>
      <TasksPage state={FOCUSED} />
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
    expect(working.textContent).toContain('@kai');
    expect(working.textContent).toContain('You');
    fireEvent.click(screen.getByText('Add the billing page'));
    expect(location.pathname).toBe('/teams/team1/p7m2/kai-task');
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

  it('shows no Owner column while your own work is in focus', () => {
    function Unfocused() {
      return <p>{useFocusedTeamTasks(createShinsaState({})) === null ? 'Your work' : 'Team'}</p>;
    }
    render(<Unfocused />);
    expect(screen.getByText('Your work')).toBeDefined();
  });
});
