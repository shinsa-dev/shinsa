import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { listSentCommands, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { createTeam, createTeamEntry } from '../../support/teams.ts';

const PROJECTS = [createProject({ id: 'work', name: 'Work' }), createProject({ id: 'home', name: 'Home' })];

function renderFocus(projectId: string | null, teamId: string | null = null) {
  const state = createShinsaState({
    projects: PROJECTS,
    patch: { focus: { projectId, teamId, until: null } },
  });
  render(<FocusMenu state={state} />);
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
}

function checked() {
  return screen
    .getAllByRole('menuitemradio')
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.textContent);
}

beforeEach(startFakeServer);

afterEach(stopFakeServer);

describe('the Focus menu', () => {
  it('checks the project in focus', async () => {
    renderFocus('home');
    await screen.findByRole('menu');
    expect(checked()).toEqual(['Home']);
  });

  it('checks Your work when nothing is in focus', async () => {
    renderFocus(null);
    await screen.findByRole('menu');
    expect(checked()).toEqual(['Your work']);
  });

  it('focuses the project you pick until you change it', async () => {
    renderFocus(null);
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Work' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'focus.change', projectId: 'work', teamId: null, until: null },
      ])
    );
  });

  it('lists the teams you are in under Teams, and leaves out one you only asked to join', async () => {
    act(() =>
      connection.replaceRemote(
        createRemoteSnapshot({
          teams: [
            createTeamEntry(),
            createTeamEntry({ id: 'team2', name: 'Waiting', team: null, status: 'requested' }),
          ],
        })
      )
    );
    renderFocus(null);
    await screen.findByRole('menu');
    expect(screen.getByText('Teams')).toBeDefined();
    expect(screen.getByRole('menuitemradio', { name: 'Platform' })).toBeDefined();
    expect(screen.queryByRole('menuitemradio', { name: 'Waiting' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Platform' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'focus.change', projectId: null, teamId: 'team1', until: null },
      ])
    );
  });

  it('names the team in focus on the button and keeps it in focus for 2 hours', async () => {
    act(() =>
      connection.replaceRemote(createRemoteSnapshot({ teams: [createTeamEntry({ team: createTeam() })] }))
    );
    renderFocus(null, 'team1');
    await screen.findByRole('menu');
    expect(checked()).toEqual(['Platform']);
    expect(screen.getByText('Keep Platform in focus')).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'For 2 hours' }));
    await waitFor(() => expect(listSentCommands()[0]).toMatchObject({ projectId: null, teamId: 'team1' }));
  });

  it('opens Settings at Teams to create or join one', async () => {
    renderFocus(null);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Create or join a team…' }));
    expect(location.pathname).toBe('/settings');
    expect(location.hash).toBe('#teams');
  });
});
