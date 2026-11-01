import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { TeamsGroup } from '@/components/settings/teams.tsx';
import type { TeamActions } from '@/lib/connection/teams.ts';
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
  } satisfies TeamActions;
}

const toasts = spyOnToasts();

afterEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
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

function renderTeams(snapshot: RemoteSnapshot | null, failure: string | null = null) {
  const actions = createActions();
  render(
    <TooltipProvider>
      <TeamsGroup state={STATE} snapshot={snapshot} failure={failure} actions={actions} />
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

  it('picks the projects a team sees in the card, starting from those it sees now', async () => {
    const actions = renderOwnedTeam();
    const picker = screen.getByRole('combobox', { name: 'Projects shared with Platform' });
    expect(picker.textContent).toBe('Web');
    await toggleProject('Projects shared with Platform', 'Api');
    await waitFor(() => expect(actions.writeProjects).toHaveBeenCalledWith(STATE, 'team1', ['web', 'api']));
  });

  it('gives a teammate access to this machine without them asking, after saying what it means', async () => {
    const actions = renderOwnedTeam();
    fireEvent.click(screen.getByRole('button', { name: 'Give machine access' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Give Kai Lane access to Studio?')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Give access' }));
    await waitFor(() => expect(actions.grantAccess).toHaveBeenCalledWith('team1', KAI.id));
    expect(toasts.success).toHaveBeenCalledWith('Kai Lane can reach Studio now.');
  });

  it('says who can reach this machine already, with no grant offered to them', () => {
    renderOwnedTeam({ access: { owner: MONA, members: [{ user: KAI, addedAt: 1 }] } });
    expect(screen.getByText(/Can reach Studio/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Give machine access' })).toBeNull();
  });

  it('offers no grant while remote access is paused', () => {
    renderOwnedTeam({ enabled: false });
    expect(screen.queryByRole('button', { name: 'Give machine access' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Give machine access' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave team' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('team1'));
  });

  it('asks for the team’s link and the projects to share right in the card on a machine without its key', async () => {
    const actions = renderTeams(
      createRemoteSnapshot({ access: ACCESS, teams: [createTeamEntry({ onMachine: false })] })
    );
    expect(screen.getByText(/This machine has no key for the team yet/)).toBeTruthy();
    const input = screen.getByLabelText('Team link');
    fireEvent.change(input, { target: { value: 'https://x.dev' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByText(/not a team link/)).toBeTruthy();
    fireEvent.change(input, { target: { value: TEAM_URL } });
    expect(screen.queryByText(/not a team link/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    expect(await screen.findByText('Pick at least one project to share with the team.')).toBeTruthy();
    expect(actions.join).not.toHaveBeenCalled();
    await toggleProject('Projects to share', 'Api');
    expect(screen.queryByText('Pick at least one project to share with the team.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    await waitFor(() => expect(actions.join).toHaveBeenCalledWith(STATE, TEAM_URL, ['api']));
    expect(toasts.success).toHaveBeenCalledWith('Platform’s tasks show here now.');
  });

  it('withdraws a request the owner has not answered', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry({ team: null })] }));
    expect(screen.getByText('You asked to join. The team’s owner has not answered yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('team1'));
  });
});
