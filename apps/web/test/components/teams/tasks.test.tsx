import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TeamTasksSection, useFocusedTeamTasks } from '@/components/teams/tasks.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { TasksPage } from '@/routes/tasks.tsx';
import { createTeamFeedTask } from '../../lib/teams/machine.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { pushTeams, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createShinsaState, createTask } from '../../support/state.ts';
import { createTeamEntry } from '../../support/teams.ts';

const FOCUSED = createShinsaState({
  tasks: [createTask({ id: 'mine', title: 'My own task', stage: 'building' })],
  patch: { focus: { projectId: null, teamId: 'team1', until: null } },
});

const OPEN = createTeamFeedTask();

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

function TeamHome() {
  const focused = useFocusedTeamTasks(FOCUSED);
  return focused ? <TeamTasksSection focused={focused} /> : <p>No team</p>;
}

describe('teammates’ tasks', () => {
  it('lists them on All tasks under the focused team, marked with whose they are, and opens one read-only', () => {
    render(
      <TooltipProvider>
        <TasksPage state={FOCUSED} />
      </TooltipProvider>
    );
    expect(screen.getByText('Teammates in Platform')).toBeDefined();
    expect(screen.getByText('Add the billing page')).toBeDefined();
    expect(screen.getByText('Ship the invoice export')).toBeDefined();
    expect(screen.getAllByText('kai')).toHaveLength(2);
    fireEvent.click(screen.getByText('Add the billing page'));
    expect(location.pathname).toBe('/teams/team1/p7m2/kai-task');
  });

  it('leaves them out of All tasks when a search matches none of them, or a status filter is on', () => {
    visit('/tasks?q=zzz');
    const { unmount } = render(
      <TooltipProvider>
        <TasksPage state={FOCUSED} />
      </TooltipProvider>
    );
    expect(screen.queryByText('Teammates in Platform')).toBeNull();
    unmount();
    visit('/tasks?status=working');
    render(
      <TooltipProvider>
        <TasksPage state={FOCUSED} />
      </TooltipProvider>
    );
    expect(screen.queryByText('Add the billing page')).toBeNull();
  });

  it('shows only their open tasks on Home, and says so when there are none', () => {
    render(
      <TooltipProvider>
        <TeamHome />
      </TooltipProvider>
    );
    expect(screen.getByText('Add the billing page')).toBeDefined();
    expect(screen.queryByText('Ship the invoice export')).toBeNull();
    const row = screen.getByText('Add the billing page').closest('[role="button"]');
    if (!(row instanceof HTMLElement)) throw new Error('No row.');
    expect(row.tagName).toBe('DIV');
    expect(row.closest('button')).toBeNull();
    expect(row.querySelector('a')).not.toBeNull();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(location.pathname).toBe('/teams/team1/p7m2/kai-task');
    history.replaceState(null, '', '/');
    fireEvent.click(screen.getByText('Add the billing page'));
    expect(location.pathname).toBe('/teams/team1/p7m2/kai-task');
    pushTeams({ machines: [], tasks: [MERGED] });
    expect(screen.getByText(/No teammate has an open task in this team/)).toBeDefined();
  });

  it('shows nothing of a team while your own work is in focus', () => {
    function Unfocused() {
      return <p>{useFocusedTeamTasks(createShinsaState({})) === null ? 'Your work' : 'Team'}</p>;
    }
    render(<Unfocused />);
    expect(screen.getByText('Your work')).toBeDefined();
  });
});
