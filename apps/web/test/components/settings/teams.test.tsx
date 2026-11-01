import { afterEach, describe, expect, it, mock } from 'bun:test';
import type { RemoteSnapshot } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function createActions() {
  const snapshot = () => Promise.resolve(createRemoteSnapshot());
  return {
    create: mock((_state: unknown, _name: string, _projects: readonly string[]) =>
      Promise.resolve({ teamId: 'team9', url: TEAM_URL })
    ),
    join: mock((_state: unknown, _url: string, _projects: readonly string[]) =>
      Promise.resolve({ status: 'requested' as const, teamId: 'team1' })
    ),
    writeProjects: mock((_state: unknown, _teamId: string, _projects: readonly string[]) =>
      Promise.resolve()
    ),
    readLink: mock((_teamId: string) => Promise.resolve({ url: TEAM_URL })),
    renewLink: mock((_teamId: string) => Promise.resolve({ url: `${TEAM_URL}-new` })),
    removeLink: mock((_teamId: string) => snapshot()),
    acceptRequest: mock((_teamId: string, _userId: string) => snapshot()),
    declineRequest: mock((_teamId: string, _userId: string) => snapshot()),
    removeMember: mock((_teamId: string, _userId: string) => snapshot()),
    leave: mock((_teamId: string) => snapshot()),
    remove: mock((_teamId: string) => snapshot()),
  } satisfies TeamActions;
}

const toasts = spyOnToasts();

afterEach(() => {
  toasts.success.mockClear();
  toasts.error.mockClear();
});

function renderTeams(snapshot: RemoteSnapshot | null, failure: string | null = null) {
  const actions = createActions();
  render(
    <TooltipProvider>
      <TeamsGroup state={STATE} snapshot={snapshot} failure={failure} actions={actions} />
    </TooltipProvider>
  );
  return actions;
}

describe('Settings → Teams', () => {
  it('waits for remote access, and needs it turned on', () => {
    renderTeams(null);
    expect(screen.getByText('Reading teams…')).toBeTruthy();
  });

  it('asks for remote access before anything else', () => {
    renderTeams(createRemoteSnapshot({ paired: false }));
    expect(screen.getByText(/Turn it on above first/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New team' })).toBeNull();
  });

  it('makes a team with the projects you tick, then shows the link that asks to join it', async () => {
    const actions = renderTeams(createRemoteSnapshot());
    expect(screen.getByText(/This machine is in no team/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New team' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make team' }));
    expect(await within(dialog).findByText('Give the team a name.')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: ' Platform ' } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Api' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Make team' }));
    await waitFor(() => expect(actions.create).toHaveBeenCalledWith(STATE, 'Platform', ['api']));
    expect(await screen.findByText('Link to join Platform')).toBeTruthy();
    expect(screen.getByText(TEAM_URL)).toBeTruthy();
    expect(toasts.success).toHaveBeenCalledWith('Platform is made.');
  });

  it('joins with a pasted link and the projects you tick, refusing a link that is not one', async () => {
    const actions = renderTeams(createRemoteSnapshot());
    fireEvent.click(screen.getByRole('button', { name: 'Join a team' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Team link'), { target: { value: 'https://x.dev' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask to join' }));
    expect(await within(dialog).findByText(/not a team link/)).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Team link'), { target: { value: TEAM_URL } });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Web' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask to join' }));
    await waitFor(() => expect(actions.join).toHaveBeenCalledWith(STATE, TEAM_URL, ['web']));
    expect(toasts.success).toHaveBeenCalledWith('Request sent.');
  });

  it('keeps the dialog open with the refusal when joining fails', async () => {
    const actions = renderTeams(createRemoteSnapshot());
    actions.join.mockImplementation(() => Promise.reject(new Error('This team link was turned off.')));
    fireEvent.click(screen.getByRole('button', { name: 'Join a team' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Team link'), { target: { value: TEAM_URL } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ask to join' }));
    expect(await within(dialog).findByText('This team link was turned off.')).toBeTruthy();
  });

  it('shows the owner who asks to join and who is in the team, and answers each', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry()] }));
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(screen.getByText('You share Web.')).toBeTruthy();
    expect(screen.getByText('Asking to join')).toBeTruthy();
    expect(screen.getByText('@bob')).toBeTruthy();
    expect(screen.getByText('Kai Lane')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(actions.acceptRequest).toHaveBeenCalledWith('team1', BOB.id));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(actions.declineRequest).toHaveBeenCalledWith('team1', BOB.id));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove member' }));
    await waitFor(() => expect(actions.removeMember).toHaveBeenCalledWith('team1', KAI.id));
  });

  it('changes which projects a team sees, starting from those it sees now', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Choose projects' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      (within(dialog).getByRole('checkbox', { name: 'Web' }) as HTMLElement).getAttribute('aria-checked')
    ).toBe('true');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Web' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Api' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(actions.writeProjects).toHaveBeenCalledWith(STATE, 'team1', ['api']));
  });

  it('shows, renews and turns off the link of a team you own', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Join link' }));
    expect(await screen.findByText(TEAM_URL)).toBeTruthy();
    expect(actions.readLink).toHaveBeenCalledWith('team1');
    fireEvent.click(screen.getByRole('button', { name: 'Make new link' }));
    expect(await screen.findByText(`${TEAM_URL}-new`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off link' }));
    await waitFor(() => expect(actions.removeLink).toHaveBeenCalledWith('team1'));
  });

  it('removes a team you own after a confirmation', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry()] }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove team' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove team' }));
    await waitFor(() => expect(actions.remove).toHaveBeenCalledWith('team1'));
  });

  it('lets a member leave, hides the owner’s controls, and asks for the key on a machine without it', async () => {
    const team = createTeam({
      owner: KAI,
      role: 'member',
      members: [{ user: MONA, addedAt: Date.now() }],
      requests: [],
    });
    const actions = renderTeams(
      createRemoteSnapshot({ teams: [createTeamEntry({ team, onMachine: false })] })
    );
    expect(screen.getByText(/does not hold the team’s key/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Join link' })).toBeNull();
    expect(screen.queryByText('Asking to join')).toBeNull();
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Leave team' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('team1'));
  });

  it('withdraws a request the owner has not answered', async () => {
    const actions = renderTeams(createRemoteSnapshot({ teams: [createTeamEntry({ team: null })] }));
    expect(screen.getByText('You asked to join. The team’s owner has not answered yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Withdraw request' }));
    await waitFor(() => expect(actions.leave).toHaveBeenCalledWith('team1'));
  });
});
