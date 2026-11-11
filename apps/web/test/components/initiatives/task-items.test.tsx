import { describe, expect, it, spyOn } from 'bun:test';
import type { RemoteSnapshot, ShinsaState, Task, TeamFeedSnapshot } from '@shinsa/core';
import { DropdownMenu, DropdownMenuContent } from '@shinsa/ui/components/dropdown-menu';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen } from '@testing-library/react';
import { InitiativeFact, InitiativeItems } from '@/components/initiatives/task-items.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { spyOnCommands } from '../../support/commands.ts';
import { spyOnEngine } from '../../support/engine.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createInitiative, createShinsaState, createTask } from '../../support/state.ts';
import { createTeamEntry } from '../../support/teams.ts';
import { addTeardown } from '../../support/teardown.ts';

const SHARED = {
  id: 'kai-split',
  name: 'Kai’s split',
  description: '',
  phases: [{ id: 'p1', name: 'Session and transport' }],
  leadTaskId: 'kai-lead',
  report: null,
  finished: false,
  updatedAt: 1,
  teamId: 'team1',
  instanceId: 'kai-machine',
};

const IN_SHARED = {
  teamId: 'team1',
  instanceId: 'kai-machine',
  initiativeId: 'kai-split',
  phaseId: 'p1',
  name: 'Kai’s split',
};

function spyOnTeams(feed: TeamFeedSnapshot, remote: RemoteSnapshot | null = createRemoteSnapshot()) {
  const teams = spyOn(connection, 'selectTeams').mockReturnValue(feed);
  const snapshot = spyOn(connection, 'selectRemote').mockReturnValue(remote);
  addTeardown(() => {
    teams.mockRestore();
    snapshot.mockRestore();
  });
}

const TEAM_REMOTE = createRemoteSnapshot({
  teams: [createTeamEntry({ id: 'team1', name: 'Studio' }), createTeamEntry({ id: 'team2', name: 'Core' })],
});

const DOCK = createTask({ id: 'dock', title: 'Rewrite the dock', initiativeId: 'split' });

const LEAD = createTask({
  id: 'lead',
  title: 'Lead the chat split',
  pipeline: ['lead'],
  stage: 'leading',
  initiativeId: 'split',
});

function renderItems(state: ShinsaState, task: Task) {
  render(
    <TooltipProvider>
      <DropdownMenu open>
        <DropdownMenuContent>
          <InitiativeItems state={state} task={task} />
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}

function menuItems() {
  return screen.queryAllByRole('menuitem').map((item) => item.textContent);
}

describe('the initiative items', () => {
  it('give a member the usual items and no edit', () => {
    spyOnEngine();
    const state = createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' })],
      tasks: [DOCK, LEAD],
    });
    renderItems(state, DOCK);
    expect(menuItems()).toContain('Take out of the initiative');
    expect(menuItems()).not.toContain('Edit the initiative');
  });

  it('give the lead only Edit the initiative', () => {
    spyOnEngine();
    const state = createShinsaState({
      initiatives: [createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead' })],
      tasks: [DOCK, LEAD],
    });
    renderItems(state, LEAD);
    expect(menuItems()).toEqual(['Edit the initiative']);
    expect(screen.queryByText('Share with a team')).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit the initiative' }));
  });

  it('let you share the lead’s initiative with each of your teams, ticked where it is shared', () => {
    spyOnEngine();
    spyOnTeams({ machines: [], tasks: [] }, TEAM_REMOTE);
    const spies = spyOnCommands();
    const state = createShinsaState({
      initiatives: [
        createInitiative({ id: 'split', name: 'Chat split', leadTaskId: 'lead', teamIds: ['team2'] }),
      ],
      tasks: [DOCK, LEAD],
    });
    renderItems(state, LEAD);
    fireEvent.click(screen.getByText('Share with a team'));
    const studio = screen.getByRole('menuitemcheckbox', { name: 'Studio' });
    expect(studio.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Core' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(studio);
    expect(spies.sent.mock.calls[0]?.[0]).toEqual({
      type: 'initiative.add_to_team',
      initiativeId: 'split',
      teamId: 'team1',
    });
  });

  it('offer a teammate’s initiatives under their own label, and join one with its team and machine', () => {
    spyOnEngine();
    spyOnTeams({ machines: [], tasks: [], initiatives: [SHARED] }, TEAM_REMOTE);
    const spies = spyOnCommands();
    const loose = createTask({ id: 'loose', title: 'Loose task' });
    renderItems(createShinsaState({ tasks: [loose] }), loose);
    fireEvent.click(screen.getByText('Add to an initiative'));
    expect(screen.getByText('Teammates’ initiatives')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Kai’s split' }));
    expect(spies.sent.mock.calls[0]?.[0]).toEqual({
      type: 'task.join_initiative',
      taskId: 'loose',
      initiativeId: 'kai-split',
      phaseId: null,
      team: { teamId: 'team1', instanceId: 'kai-machine', name: 'Kai’s split' },
    });
  });

  it('give a member of a teammate’s initiative its phases and a way out, and no Make an initiative', () => {
    spyOnEngine();
    spyOnTeams({ machines: [], tasks: [], initiatives: [SHARED] }, TEAM_REMOTE);
    const spies = spyOnCommands();
    const member = createTask({ id: 'member', teamInitiative: IN_SHARED });
    renderItems(createShinsaState({ tasks: [member] }), member);
    expect(menuItems()).not.toContain('Make an initiative from this task');
    expect(screen.getByText('Phase')).toBeTruthy();
    fireEvent.click(screen.getByText('Phase'));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'No phase' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Take out of the initiative' }));
    expect(spies.sent.mock.calls.map(([command]) => command)).toEqual([
      {
        type: 'task.join_initiative',
        taskId: 'member',
        initiativeId: 'kai-split',
        phaseId: null,
        team: { teamId: 'team1', instanceId: 'kai-machine', name: 'Kai’s split' },
      },
      { type: 'task.join_initiative', taskId: 'member', initiativeId: null, phaseId: null },
    ]);
  });
});

describe('the initiative fact', () => {
  it('names a teammate’s initiative and its phase, and opens its lead read-only', () => {
    spyOnTeams({ machines: [], tasks: [], initiatives: [SHARED] });
    const member = createTask({ id: 'member', teamInitiative: IN_SHARED });
    render(
      <TooltipProvider>
        <InitiativeFact state={createShinsaState({ tasks: [member] })} task={member} />
      </TooltipProvider>
    );
    const button = screen.getByRole('button', { name: 'Kai’s split · Session and transport' });
    fireEvent.click(button);
    expect(window.location.pathname).toBe('/teams/team1/kai-machine/kai-lead');
  });

  it('keeps the name it joined with while the teammate’s machine is away', () => {
    spyOnTeams({ machines: [], tasks: [] });
    const member = createTask({ id: 'member', teamInitiative: IN_SHARED });
    render(
      <TooltipProvider>
        <InitiativeFact state={createShinsaState({ tasks: [member] })} task={member} />
      </TooltipProvider>
    );
    expect((screen.getByRole('button', { name: 'Kai’s split' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
