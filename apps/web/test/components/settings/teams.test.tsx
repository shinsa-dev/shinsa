import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test';
import {
  ACCESS_PRESETS,
  type AccessScopes,
  DEFAULT_TEAM_SCOPES,
  type RemoteSnapshot,
  TEAM_REFUSALS,
  toggleScope,
} from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeamsGroup } from '@/components/settings/teams.tsx';
import { connection } from '@/lib/connection/socket.ts';
import type { TeamActions } from '@/lib/connection/teams.ts';
import {
  TEAM_KEY_OWNER_WAITING,
  TEAM_KEY_UPDATE,
  TEAM_KEY_WAITING,
  TEAM_MACHINE_NEEDS_KEY,
} from '@/lib/teams/settings.ts';
import { spyOnToasts } from '../../support/commands.ts';
import { createRemoteSnapshot } from '../../support/remote-access.ts';
import { createProject, createShinsaState } from '../../support/state.ts';
import { BOB, createTeam, createTeamEntry, KAI, MONA, TEAM_URL } from '../../support/teams.ts';

const STATE = createShinsaState({
  projects: [
    createProject({ id: 'web', name: 'Web', teamIds: ['team1'] }),
    createProject({ id: 'api', name: 'Api' }),
  ],
});

const ACCESS = { owner: MONA, members: [] };

function createActions() {
  const snapshot = () => Promise.resolve(createRemoteSnapshot());
  return {
    create: mock((_state: unknown, _name: string, _projects: readonly string[]) =>
      Promise.resolve({ teamId: 'team9', url: TEAM_URL })
    ),
    join: mock((_state: unknown, _url: string, _projects: readonly string[]) =>
      Promise.resolve({ status: 'member' as const, teamId: 'team1' })
    ),
    writeProjects: mock((_state: unknown, _teamId: string, _projects: readonly string[]) =>
      Promise.resolve()
    ),
    readLink: mock((_teamId: string) => Promise.resolve({ url: TEAM_URL })),
    removeLink: mock((_teamId: string) => snapshot()),
    acceptRequest: mock((_teamId: string, _userId: string) => snapshot()),
    declineRequest: mock((_teamId: string, _userId: string) => snapshot()),
    removeMember: mock((_teamId: string, _userId: string) => snapshot()),
    leave: mock((_teamId: string) => snapshot()),
    remove: mock((_teamId: string) => snapshot()),
    grantAccess: mock((_teamId: string, _userId: string) => snapshot()),
    updateScopes: mock((_teamId: string, _userId: string | null, _scopes: AccessScopes | null) => snapshot()),
    updateExtra: mock((_teamId: string, _userId: string, _scopes: AccessScopes) => snapshot()),
    requestKey: mock((_teamId: string) => snapshot()),
    answerKey: mock((_teamId: string, _instanceId: string, _approve: boolean) => snapshot()),
  } satisfies TeamActions;
}

let toasts: ReturnType<typeof spyOnToasts>;

beforeEach(() => {
  toasts = spyOnToasts();
});

afterEach(() => {
  toasts.restore();
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function toggleProject(label: string, option: string) {
  fireEvent.click(screen.getByRole('combobox', { name: label }));
  await settle();
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: option });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
  await settle();
}

async function chooseOption(label: string, option: string, scope: HTMLElement = document.body) {
  fireEvent.click(within(scope).getByRole('combobox', { name: label }));
  await settle();
  const list = screen.getAllByRole('listbox').at(-1) as HTMLElement;
  const item = within(list).getByRole('option', { name: (name) => name.startsWith(option) });
  fireEvent.pointerDown(item, { pointerType: 'mouse' });
  fireEvent.click(item);
}

function renderTeams(
  snapshot: RemoteSnapshot | null,
  failure: string | null = null,
  rights = false,
  keys = false
) {
  const actions = createActions();
  render(
    <TooltipProvider>
      <TeamsGroup
        state={STATE}
        snapshot={snapshot}
        failure={failure}
        actions={actions}
        rights={rights}
        keys={keys}
      />
    </TooltipProvider>
  );
  return actions;
}

function renderOwnedTeam(overrides: Partial<RemoteSnapshot> = {}) {
  return renderTeams(createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry()], ...overrides }));
}

describe('Settings → Teams', () => {
  it('waits for remote access, and needs it turned on', () => {
    renderTeams(null);
    expect(screen.getByText('Reading teams…')).toBeTruthy();
  });

  it('asks for remote access before anything else, and has no Join a team', () => {
    renderTeams(createRemoteSnapshot({ paired: false }));
    expect(screen.getByText(/Turn it on above first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Join a team' })).toBeNull();
  });

  it('makes a team with the projects you pick, then shows its join link with a QR code', async () => {
    const actions = renderTeams(createRemoteSnapshot());
    expect(screen.getByText(/You are in no team yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make team' }));
    expect(await within(dialog).findByText('Give the team a name.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Platform ' } });
    await toggleProject('Shared projects', 'Api');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make team' }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledWith(STATE, 'Platform', ['api']));
    expect(await screen.findByText('Join link for Platform')).toBeTruthy();
    expect(screen.getByText(TEAM_URL)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'QR code for the link' })).toBeTruthy();
    expect(toasts.success).toHaveBeenCalledWith('Platform is made.');
  });

  it('keeps the new team dialog open with the refusal when making it fails', async () => {
    const actions = renderTeams(createRemoteSnapshot());
    actions.create.mockImplementation(() => Promise.reject(new Error('You own 10 teams already.')));
    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Platform' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make team' }));
    expect(await within(dialog).findByText('You own 10 teams already.')).toBeTruthy();
  });

  it('shows the owner who asks to join and who is in the team, and answers each', async () => {
    const actions = renderOwnedTeam();
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(screen.getByText('Asking to join')).toBeTruthy();
    expect(screen.getByText('bob')).toBeTruthy();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(actions.acceptRequest).toHaveBeenCalledWith('team1', BOB.id));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(actions.declineRequest).toHaveBeenCalledWith('team1', BOB.id));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(actions.removeMember).toHaveBeenCalledWith('team1', KAI.id));
  });

  it('lets the owner pick a preset or a scope for the team, and for one person', async () => {
    const team = createTeam({ overrides: [{ userId: KAI.id, scopes: ACCESS_PRESETS.full }] });
    const actions = renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team })] }),
      null,
      true
    );
    expect(screen.getByText('Collaborate · 5 of 6 scopes')).toBeTruthy();
    expect(screen.getByText(/Own scopes/)).toBeTruthy();
    fireEvent.click(screen.getByText('What teammates can do'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Message agents' }));
    await waitFor(() =>
      expect(actions.updateScopes).toHaveBeenCalledWith(
        'team1',
        null,
        toggleScope(DEFAULT_TEAM_SCOPES, 'message', true)
      )
    );
    await chooseOption('Preset for the team', 'View only');
    await waitFor(() =>
      expect(actions.updateScopes).toHaveBeenCalledWith('team1', null, ACCESS_PRESETS.standard)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scopes' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('What Kai can do')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Fork tasks for Kai' }));
    await waitFor(() =>
      expect(actions.updateScopes).toHaveBeenCalledWith(
        'team1',
        KAI.id,
        toggleScope(ACCESS_PRESETS.full, 'fork', false)
      )
    );
    await chooseOption('Preset for Kai', 'Team’s (Collaborate)', dialog);
    await waitFor(() => expect(actions.updateScopes).toHaveBeenCalledWith('team1', KAI.id, null));
  });

  it('shows a member the team’s scopes without letting them change any, and hides them from an older engine', () => {
    const team = createTeam({
      owner: KAI,
      role: 'member',
      members: [{ user: MONA, addedAt: 1 }],
      requests: [],
    });
    renderTeams(createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team })] }), null, true);
    fireEvent.click(screen.getByText('What teammates can do'));
    expect(screen.getByText('Only Kai Lane changes these.')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: 'Act on tasks' }) as HTMLElement).getAttribute('aria-disabled')
    ).toBe('true');
    expect(screen.queryByRole('button', { name: 'Scopes' })).toBeNull();
    cleanup();
    renderOwnedTeam();
    expect(screen.queryByText('What teammates can do')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Scopes' })).toBeNull();
  });

  it('says whether each teammate is online, away or offline, from the team’s live channels', () => {
    const feed = spyOn(connection, 'selectTeams').mockReturnValue({
      tasks: [],
      machines: [
        {
          teamId: 'team1',
          instanceId: 'm1',
          name: 'Studio',
          userId: KAI.id,
          status: 'live',
          reason: null,
          presence: [{ userId: KAI.id, status: 'away', seenAt: Date.now() - 120_000 }],
        },
      ],
    });
    renderOwnedTeam();
    expect(screen.getByText(/^Seen 2m ago · /)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Away' })).toBeTruthy();
    feed.mockRestore();
  });

  it('picks the projects a team sees in the card, starting from those it sees now', async () => {
    const actions = renderOwnedTeam();
    const picker = screen.getByRole('combobox', { name: 'Projects shared with Platform' });
    expect(picker.textContent).toBe('Web');
    await toggleProject('Projects shared with Platform', 'Api');
    await waitFor(() => expect(actions.writeProjects).toHaveBeenCalledWith(STATE, 'team1', ['web', 'api']));
  });

  it('gives a teammate more on this machine than the team does, with the team’s scopes locked on', async () => {
    const actions = renderOwnedTeam();
    fireEvent.click(screen.getByRole('button', { name: 'On “Studio”' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('What Kai can do on “Studio”')).toBeTruthy();
    const gates = within(dialog).getByRole('checkbox', { name: 'Answer gates for Kai' });
    expect(gates.getAttribute('aria-disabled')).toBe('true');
    const message = within(dialog).getByRole('checkbox', { name: 'Message agents for Kai' });
    expect(message.getAttribute('aria-disabled')).not.toBe('true');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Message agents for Kai' }));
    await waitFor(() => expect(actions.updateExtra).toHaveBeenCalledWith('team1', KAI.id, ['message']));
  });

  it('says a teammate has more on this machine', () => {
    renderOwnedTeam({
      teams: [createTeamEntry({ extras: [{ userId: KAI.id, scopes: ['message'] }] })],
    });
    expect(screen.getByText(/More on “Studio”/)).toBeTruthy();
  });

  it('gives a teammate full access to this machine without them asking, after saying what it means', async () => {
    const actions = renderOwnedTeam();
    fireEvent.click(screen.getByRole('button', { name: 'On “Studio”' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Give full access to “Studio”' }));
    const dialog = await screen.findByRole('dialog', { name: 'Give Kai access to “Studio”?' });
    expect(within(dialog).getByText('Give Kai access to “Studio”?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));
    await waitFor(() => expect(actions.grantAccess).toHaveBeenCalledWith('team1', KAI.id));
    expect(toasts.success).toHaveBeenCalledWith('Kai can reach “Studio” now.');
  });

  it('says who can reach this machine already, with no grant offered to them', () => {
    renderOwnedTeam({ access: { owner: MONA, members: [{ user: KAI, addedAt: 1 }] } });
    expect(screen.getByText(/Can reach “Studio”/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'On “Studio”' })).toBeNull();
  });

  it('offers no grant while remote access is paused', () => {
    renderOwnedTeam({ enabled: false });
    expect(screen.queryByRole('button', { name: 'On “Studio”' })).toBeNull();
  });

  it('turns off the link of a team you own', async () => {
    const actions = renderOwnedTeam();
    fireEvent.click(screen.getByRole('button', { name: 'Join link' }));
    expect(await screen.findByText(TEAM_URL)).toBeTruthy();
    expect(actions.readLink).toHaveBeenCalledWith('team1');
    expect(screen.queryByRole('button', { name: 'Make new link' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }));
    await waitFor(() => expect(actions.removeLink).toHaveBeenCalledWith('team1'));
  });

  it('deletes a team you own after a confirmation', async () => {
    const actions = renderOwnedTeam();
    fireEvent.click(screen.getByRole('button', { name: 'Delete team' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete Platform?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete team' }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith('team1'));
  });

  it('lets a member leave, hides the owner’s controls and can grant the owner access', async () => {
    const team = createTeam({
      owner: KAI,
      role: 'member',
      members: [{ user: MONA, addedAt: Date.now() }],
      requests: [],
    });
    const actions = renderTeams(createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team })] }));
    expect(screen.queryByRole('button', { name: 'Join link' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete team' })).toBeNull();
    expect(screen.queryByText('Asking to join')).toBeNull();
    expect(screen.getByText('You')).toBeTruthy();
    const owned = screen.getByText(/^Owned by/);
    expect(owned.textContent).toStartWith('Owned by KKai · 2 people');
    expect(owned.querySelector('a')?.getAttribute('href')).toBe('https://github.com/kai');
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'On “Studio”' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave team' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('team1'));
  });

  it('tells a machine in the team without its key that it waits for it, and asks for access', async () => {
    const team = createTeam({
      owner: KAI,
      role: 'member',
      members: [{ user: MONA, addedAt: Date.now() }],
      machines: [{ id: 'k3x9', name: 'Studio', userId: MONA.id, online: true, lastSeenAt: Date.now() }],
    });
    const actions = renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team, onMachine: false })] }),
      null,
      false,
      true
    );
    expect(screen.getByText(TEAM_KEY_WAITING)).toBeTruthy();
    expect(screen.getByText(TEAM_MACHINE_NEEDS_KEY)).toBeTruthy();
    expect(screen.queryByLabelText('Team link')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(actions.requestKey).toHaveBeenCalledWith('team1'));
    expect((await screen.findByText(/gives this machine access/)).textContent).toContain('Kai');
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
  });

  it('keeps Request access when asking fails, and tells an owner its other machines bring the key', async () => {
    const team = createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: Date.now() }] });
    const actions = renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team, onMachine: false })] }),
      null,
      false,
      true
    );
    actions.requestKey.mockImplementation(() => Promise.reject(new Error('Offline.')));
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Request access' })).toBeTruthy();
    cleanup();
    renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ onMachine: false })] }),
      null,
      false,
      true
    );
    expect(screen.getByText(TEAM_KEY_OWNER_WAITING)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Request access' })).toBeNull();
    cleanup();
    renderTeams(createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ onMachine: false })] }));
    expect(screen.getByText(TEAM_KEY_UPDATE)).toBeTruthy();
  });

  it('lets the team’s owner give a teammate’s machine access, or decline', async () => {
    const team = createTeam();
    const asking = {
      teamId: 'team1',
      instanceId: 'jake1',
      name: 'Mac.lan',
      userId: KAI.id,
      status: 'refused' as const,
      reason: TEAM_REFUSALS.key,
      asking: true,
    };
    const feed = spyOn(connection, 'selectTeams').mockReturnValue({ machines: [asking], tasks: [] });
    const actions = renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team })] }),
      null,
      false,
      true
    );
    expect(screen.getByText('Asking for access')).toBeTruthy();
    expect(screen.getByText(/asks for access to this team’s tasks/).textContent).toBe(
      '“Mac.lan” by KKai asks for access to this team’s tasks'
    );
    const row = screen.getByText(/asks for access/).closest('[class*="flex"]')?.parentElement as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Give access' }));
    await waitFor(() => expect(actions.answerKey).toHaveBeenCalledWith('team1', 'jake1', true));
    expect(toasts.success).toHaveBeenCalledWith('“Mac.lan” gets access in a moment.');
    fireEvent.click(within(row).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(actions.answerKey).toHaveBeenCalledWith('team1', 'jake1', false));
    feed.mockRestore();
  });

  it('lets a member give another of their own machines access', async () => {
    const team = createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: Date.now() }] });
    const asking = {
      teamId: 'team1',
      instanceId: 'mona2',
      name: 'Laptop',
      userId: MONA.id,
      status: 'refused' as const,
      reason: TEAM_REFUSALS.key,
      asking: true,
    };
    const feed = spyOn(connection, 'selectTeams').mockReturnValue({ machines: [asking], tasks: [] });
    const actions = renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ team })] }),
      null,
      false,
      true
    );
    fireEvent.click(screen.getByRole('button', { name: 'Give access' }));
    await waitFor(() => expect(actions.answerKey).toHaveBeenCalledWith('team1', 'mona2', true));
    feed.mockRestore();
  });

  it('withdraws a request the owner has not answered', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry({ team: null })] }));
    expect(screen.getByText('You asked to join. The team’s owner has not answered yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('team1'));
  });
});
