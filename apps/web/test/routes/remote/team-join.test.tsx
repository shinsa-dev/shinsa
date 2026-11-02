import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { stashTeamJoinFragment } from '@/lib/teams/join.ts';
import { TeamJoinPage } from '@/routes/remote/team-join.tsx';

const KEY = 'A'.repeat(43);

const LINK = { teamId: 'team1', invite: 'invite-1', key: KEY };

const TEAM_KEYS = { selectTeamKey: () => Promise.resolve(null), writeTeamKey: () => Promise.resolve() };

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const DASHBOARD = {
  joinTeam: () => Promise.reject(new Error('unused')),
  previewTeam: () => Promise.resolve({ name: 'Platform', owner: MONA }),
};

afterEach(() => sessionStorage.clear());

describe('the team join page on app.shinsa.dev', () => {
  it('says an incomplete link cannot add you', () => {
    render(<TeamJoinPage link={null} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} />);
    expect(screen.getByText('This link cannot add you to a team')).toBeTruthy();
  });

  it('says what a teammate sees, asks to join, and says who answers', async () => {
    stashTeamJoinFragment(sessionStorage, `#team1.invite-1.${KEY}`);
    const request = mock(() =>
      Promise.resolve({ name: 'Platform', owner: KAI, status: 'requested' as const })
    );
    render(<TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} request={request} />);
    expect(screen.getByText('Read-only, and never the chat')).toBeTruthy();
    expect(await screen.findByText('Join Platform')).toBeTruthy();
    const owns = screen.getByText(/owns this team/);
    expect(owns.textContent).toStartWith('MMona owns this team.');
    expect(owns.querySelector('a')?.getAttribute('href')).toBe('https://github.com/mona');
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Request sent')).toBeTruthy();
    const answers = screen.getByText(/accepts or declines your request to join Platform/);
    expect(answers.textContent).toStartWith('KKai accepts');
    expect(answers.querySelector('a')?.getAttribute('href')).toBe('https://github.com/kai');
    expect(screen.getByText('Paste this link into the team’s card.')).toBeTruthy();
    expect(screen.getByText(`${location.origin}/share/team#team1.invite-1.${KEY}`)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });

  it('says a link turned off before anyone asks, and keeps a generic title', async () => {
    const dashboard = {
      ...DASHBOARD,
      previewTeam: () => Promise.reject(new Error('This team link was turned off.')),
    };
    render(<TeamJoinPage link={LINK} dashboard={dashboard} teamKeys={TEAM_KEYS} />);
    expect((await screen.findByRole('alert')).textContent).toBe('This team link was turned off.');
    expect(screen.getByText('Join a team')).toBeTruthy();
  });

  it('asks which projects to share from your machines before it asks to join, then shares them there', async () => {
    const shared: [string, string, readonly string[]][] = [];
    const machine = (id: string, name: string, projects: { id: string; name: string; color: string }[]) => ({
      id,
      name,
      projects,
      share: (joinUrl: string, projectIds: readonly string[]) => {
        shared.push([id, joinUrl, projectIds]);
        return Promise.resolve();
      },
    });
    const close = mock(() => undefined);
    const openMachines = () =>
      Promise.resolve({
        machines: [
          machine('k3x9', 'Studio', [{ id: 'web', name: 'Web', color: 'blue' }]),
          machine('p7m2', 'Laptop', [{ id: 'api', name: 'Api', color: 'green' }]),
          machine('e1', 'Empty', []),
        ],
        close,
      });
    const request = mock(() =>
      Promise.resolve({ name: 'Platform', owner: KAI, status: 'requested' as const })
    );
    const { unmount } = render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openMachines}
        request={request}
      />
    );
    expect(await screen.findByText('Projects to share from Studio')).toBeTruthy();
    expect(screen.queryByText('Projects to share from Empty')).toBeNull();
    expect(screen.getByText(/Teammates see the projects you pick below/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Pick at least one project to share with the team.')).toBeTruthy();
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('combobox', { name: 'Projects to share from Studio' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const option = within(screen.getAllByRole('listbox').at(-1) as HTMLElement).getByRole('option', {
      name: 'Web',
    });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByText('Pick at least one project to share with the team.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('You share Web with the team.')).toBeTruthy();
    const url = `${location.origin}/share/team#team1.invite-1.${KEY}`;
    expect(shared).toEqual([
      ['k3x9', url, ['web']],
      ['p7m2', url, []],
    ]);
    expect(screen.queryByText('Paste this link into the team’s card.')).toBeNull();
    unmount();
    expect(close).toHaveBeenCalled();
  });

  it('asks to join without a pick when the machines cannot be read, and closes what opens too late', async () => {
    const failing = () => Promise.reject(new Error('offline'));
    const { unmount } = render(
      <TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} openMachines={failing} />
    );
    expect(await screen.findByText(/Your own tasks stay private until you pick projects/)).toBeTruthy();
    unmount();
    const close = mock(() => undefined);
    let resolve: (value: { machines: never[]; close: () => void }) => void = () => undefined;
    const late = () => new Promise<{ machines: never[]; close: () => void }>((done) => (resolve = done));
    const second = render(
      <TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} openMachines={late} />
    );
    expect(screen.getByText('Reading your projects')).toBeTruthy();
    second.unmount();
    resolve({ machines: [], close });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('welcomes someone already in the team, and shows a refusal on the page', async () => {
    const request = mock(() => Promise.reject(new Error('This team link was turned off.')));
    const { unmount } = render(
      <TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} request={request} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('This team link was turned off.')).toBeTruthy();
    unmount();
    const member = mock(() => Promise.resolve({ name: 'Platform', owner: KAI, status: 'member' as const }));
    render(<TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} request={member} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('You are in Platform')).toBeTruthy();
  });
});
