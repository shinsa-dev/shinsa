import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { type Focus, HOUR_MS, NO_FOCUS, resolveEngineInfo } from '@shinsa/core';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FocusMenu } from '@/components/focus/menu.tsx';
import { connection } from '@/lib/connection/socket.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { listSentCommands, pushEngine, startFakeServer, stopFakeServer } from '../../support/server.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { createTeam, createTeamEntry } from '../../support/teams.ts';

const PROJECTS = [createProject({ id: 'work', name: 'Work' }), createProject({ id: 'home', name: 'Home' })];

const MORE_PROJECTS = [...PROJECTS, createProject({ id: 'shop', name: 'Shop' })];

function renderMultiFocus(focus: Partial<Focus>) {
  pushEngine(resolveEngineInfo('2.0.0'));
  const state = createShinsaState({ projects: MORE_PROJECTS, patch: { focus: { ...NO_FOCUS, ...focus } } });
  render(<FocusMenu state={state} />);
  return screen.getByRole('button', { name: /^Focus/ });
}

function ticked() {
  return screen
    .getAllByRole('menuitemcheckbox')
    .filter((item) => item.getAttribute('aria-checked') === 'true')
    .map((item) => item.textContent);
}

function renderFocus(projectId: string | null, teamId: string | null = null) {
  const state = createShinsaState({
    projects: PROJECTS,
    patch: { focus: { projectIds: projectId ? [projectId] : [], except: false, teamId, until: null } },
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
    expect(location.search).toBe('?tab=connections');
    expect(location.hash).toBe('#teams');
  });
});

describe('the Focus menu on an engine that focuses on several projects', () => {
  it.each([
    [{}, 'Your work'],
    [{ projectIds: ['work'] }, 'Work'],
    [{ projectIds: ['home', 'work'] }, 'Home and Work'],
    [{ projectIds: ['home', 'shop', 'work'] }, '3 projects'],
    [{ projectIds: ['work'], except: true }, 'All but Work'],
  ])('names the focus %j on the button as %s', (focus, label) => {
    expect(renderMultiFocus(focus).textContent).toBe(`Focus${label}`);
  });

  it('stays a single choice on an engine from before focusing on several projects', async () => {
    const engine = resolveEngineInfo('1.0.0');
    pushEngine({ ...engine, features: engine.features.filter((feature) => feature !== 'focus.projects') });
    renderFocus('home');
    await screen.findByRole('menu');
    expect(checked()).toEqual(['Home']);
    expect(screen.queryByRole('menuitemcheckbox')).toBeNull();
  });

  it('ticks the projects in focus and keeps the menu open while you add one', async () => {
    fireEvent.click(renderMultiFocus({ projectIds: ['work'] }));
    await screen.findByRole('menu');
    expect(ticked()).toEqual(['Work']);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Home' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        {
          type: 'focus.change',
          projectId: null,
          projectIds: ['home', 'work'],
          except: false,
          teamId: null,
          until: null,
        },
      ])
    );
    expect(screen.getByRole('menu')).toBeDefined();
  });

  it('sends a single project as projectId once you untick the other, keeping the focus timer', async () => {
    const until = Date.now() + HOUR_MS;
    fireEvent.click(renderMultiFocus({ projectIds: ['home', 'work'], until }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Home' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([{ type: 'focus.change', projectId: 'work', teamId: null, until }])
    );
  });

  it('shows everything but the ticked projects when you turn on Show all but these', async () => {
    fireEvent.click(renderMultiFocus({ projectIds: ['work'] }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Show all but these' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        {
          type: 'focus.change',
          projectId: null,
          projectIds: ['work'],
          except: true,
          teamId: null,
          until: null,
        },
      ])
    );
  });

  it('offers Show all but these only once a project is ticked, and Your work clears the focus', async () => {
    fireEvent.click(renderMultiFocus({}));
    await screen.findByRole('menu');
    expect(ticked()).toEqual(['Your work']);
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Show all but these' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Your work' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'focus.change', projectId: null, teamId: null, until: null },
      ])
    );
  });

  it('keeps the whole set in focus for 2 hours', async () => {
    fireEvent.click(renderMultiFocus({ projectIds: ['work'], except: true }));
    expect(await screen.findByText('Keep All but Work in focus')).toBeDefined();
    fireEvent.click(screen.getByRole('menuitem', { name: 'For 2 hours' }));
    await waitFor(() =>
      expect(listSentCommands()[0]).toMatchObject({ projectIds: ['work'], except: true, teamId: null })
    );
  });

  it('starts a new set from the project you tick while a team is in focus', async () => {
    act(() =>
      connection.replaceRemote(createRemoteSnapshot({ teams: [createTeamEntry({ team: createTeam() })] }))
    );
    fireEvent.click(renderMultiFocus({ teamId: 'team1' }));
    await screen.findByRole('menu');
    expect(ticked()).toEqual([]);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Shop' }));
    await waitFor(() =>
      expect(listSentCommands()).toEqual([
        { type: 'focus.change', projectId: 'shop', teamId: null, until: null },
      ])
    );
  });
});
