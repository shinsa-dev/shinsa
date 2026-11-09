import { afterEach, describe, expect, it, mock } from 'bun:test';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JoinMachines, JoinSetup } from '@/lib/teams/join-machines.ts';
import { stashTeamJoinFragment } from '@/lib/teams/join.ts';
import { TeamJoinPage } from '@/routes/remote/team-join.tsx';

const KEY = 'A'.repeat(43);

const LINK = { teamId: 'team1', invite: 'invite-1', key: KEY };

const URL = `${location.origin}/share/team#team1.invite-1.${KEY}`;

const TEAM_KEYS = { selectTeamKey: () => Promise.resolve(null), writeTeamKey: () => Promise.resolve() };

const MONA = { id: '1', login: 'mona', name: 'Mona Lisa', avatarUrl: null };

const KAI = { id: '2', login: 'kai', name: 'Kai Lane', avatarUrl: null };

const DASHBOARD = {
  joinTeam: () => Promise.reject(new Error('unused')),
  previewTeam: () => Promise.resolve({ name: 'Platform', owner: MONA }),
};

const NO_SHARE_HINT =
  'Your teammates see nothing of yours until you share a project. You can do this later in Settings → Teams.';

type Joined = [string, string, readonly string[]];

function createMachine(
  joined: Joined[],
  id: string,
  name: string,
  projects: { id: string; name: string; color: string }[]
) {
  return {
    id,
    name,
    projects,
    join: (joinUrl: string, projectIds: readonly string[]) => {
      joined.push([id, joinUrl, projectIds]);
      return Promise.resolve();
    },
  };
}

function openWith(machines: JoinMachines['machines'], setup: JoinSetup | null = null, close = () => {}) {
  return () => Promise.resolve({ machines, setup, close });
}

function openMachineless() {
  return () => Promise.resolve({ machines: [], setup: { kind: 'pair' as const }, close: () => {} });
}

const NO_MACHINE_HINT =
  'You have no machine paired, so you share no projects. You reach the team through the machines shared with it.';

function requested() {
  return mock(() => Promise.resolve({ name: 'Platform', owner: KAI, status: 'requested' as const }));
}

afterEach(() => sessionStorage.clear());

describe('the team join page on app.shinsa.dev', () => {
  it('says an incomplete link cannot add you', () => {
    render(
      <TeamJoinPage link={null} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} openMachines={openWith([])} />
    );
    expect(screen.getByText('This link cannot add you to a team')).toBeTruthy();
  });

  it('asks you to turn on remote access first, and joins without a machine only when you say you have none', async () => {
    stashTeamJoinFragment(sessionStorage, `#team1.invite-1.${KEY}`);
    const request = requested();
    render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openMachineless()}
        request={request}
      />
    );
    expect(await screen.findByText('Turn on remote access first')).toBeTruthy();
    expect(screen.getByText(/check again to join Platform and share your projects/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Join without a machine' }));
    expect(await screen.findByText('Join Platform')).toBeTruthy();
    expect(screen.getByText(/you see your teammates’ tasks here\./)).toBeTruthy();
    expect(screen.getByText('No machine of your own needed')).toBeTruthy();
    expect(screen.queryByText('You choose what you share')).toBeNull();
    expect(screen.queryByText('Turn on remote access first')).toBeNull();
    expect(screen.queryByText(NO_SHARE_HINT)).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ask to join' }).hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Request sent')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByText(NO_MACHINE_HINT)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });

  it('walks you through adding this browser, waiting on a request, or opening an offline machine', async () => {
    const { unmount } = render(
      <TeamJoinPage
        link={LINK}
        dashboard={{ ...DASHBOARD, previewTeam: () => new Promise<never>(() => undefined) }}
        teamKeys={TEAM_KEYS}
        openMachines={openWith([], { kind: 'add', machines: ['Studio'] })}
      />
    );
    expect(await screen.findByText('Add this device to your machine')).toBeTruthy();
    expect(
      screen.getByText(/“Studio” is paired, but this browser has no key for it yet\. .* join the team\./)
    ).toBeTruthy();
    expect(screen.getByText(/On “Studio”, open Settings > Remote access/)).toBeTruthy();
    unmount();
    const waiting = render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openWith([], { kind: 'waiting', machines: ['Studio', 'Laptop'] })}
      />
    );
    expect(await screen.findByText('Waiting for your machine')).toBeTruthy();
    expect(screen.getByText(/This browser asked to reach “Studio” and “Laptop”\./)).toBeTruthy();
    waiting.unmount();
    render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openWith([], { kind: 'offline', machines: ['Studio', 'Laptop'] })}
      />
    );
    expect(await screen.findByText('Open Shinsa on your machine')).toBeTruthy();
    expect(screen.getByText(/“Studio” and “Laptop” are offline\. .* give them the team’s key/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
  });

  it('names every machine this browser still needs adding to', async () => {
    render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openWith([], { kind: 'add', machines: ['Studio', 'Laptop'] })}
      />
    );
    expect(
      await screen.findByText(/“Studio” and “Laptop” are paired, but this browser has no key for them yet/)
    ).toBeTruthy();
  });

  it('gives every reachable machine the team key without a pick, says what a teammate sees and who answers', async () => {
    stashTeamJoinFragment(sessionStorage, `#team1.invite-1.${KEY}`);
    const joined: Joined[] = [];
    const request = requested();
    render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openWith([
          createMachine(joined, 'k3x9', 'Studio', [{ id: 'web', name: 'Web', color: 'blue' }]),
          createMachine(joined, 'e1', 'Empty', []),
        ])}
        request={request}
      />
    );
    expect(screen.getByText('Pick up their work here')).toBeTruthy();
    expect(await screen.findByText('Join Platform')).toBeTruthy();
    expect(await screen.findByText(/you see your teammates’ tasks next to your own\./)).toBeTruthy();
    const owns = screen.getByText(/owns this team/);
    expect(owns.textContent).toStartWith('MMona owns this team.');
    expect(owns.querySelector('a')?.getAttribute('href')).toBe('https://github.com/mona');
    expect(await screen.findByText(NO_SHARE_HINT)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Request sent')).toBeTruthy();
    expect(request).toHaveBeenCalledTimes(1);
    expect(joined).toEqual([
      ['k3x9', URL, []],
      ['e1', URL, []],
    ]);
    const answers = screen.getByText(/accepts or declines your request to join Platform/);
    expect(answers.textContent).toStartWith('KKai accepts');
    expect(answers.querySelector('a')?.getAttribute('href')).toBe('https://github.com/kai');
    expect(screen.getByText(NO_SHARE_HINT)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });

  it('says a link turned off before anyone asks, and keeps a generic title', async () => {
    const dashboard = {
      ...DASHBOARD,
      previewTeam: () => Promise.reject(new Error('This team link was turned off.')),
    };
    render(
      <TeamJoinPage link={LINK} dashboard={dashboard} teamKeys={TEAM_KEYS} openMachines={openWith([])} />
    );
    expect((await screen.findByRole('alert')).textContent).toBe('This team link was turned off.');
    expect(screen.getByText('Join a team')).toBeTruthy();
  });

  it('offers the projects on each machine, then joins every machine and shares the picks there', async () => {
    const joined: Joined[] = [];
    const close = mock(() => undefined);
    const { unmount } = render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={openWith(
          [
            createMachine(joined, 'k3x9', 'Studio', [{ id: 'web', name: 'Web', color: 'blue' }]),
            createMachine(joined, 'p7m2', 'Laptop', [{ id: 'api', name: 'Api', color: 'green' }]),
            createMachine(joined, 'e1', 'Empty', []),
          ],
          null,
          close
        )}
        request={requested()}
      />
    );
    expect(await screen.findByText('Projects to share from “Studio”')).toBeTruthy();
    expect(screen.queryByText('Projects to share from Empty')).toBeNull();
    expect(screen.getByText(/Teammates see the projects you pick below/)).toBeTruthy();
    fireEvent.click(screen.getByRole('combobox', { name: 'Projects to share from “Studio”' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    const option = within(screen.getAllByRole('listbox').at(-1) as HTMLElement).getByRole('option', {
      name: 'Web',
    });
    fireEvent.pointerDown(option, { pointerType: 'mouse' });
    fireEvent.click(option);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.queryByText(NO_SHARE_HINT)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('You share Web with the team.')).toBeTruthy();
    expect(joined).toEqual([
      ['k3x9', URL, ['web']],
      ['p7m2', URL, []],
      ['e1', URL, []],
    ]);
    unmount();
    expect(close).toHaveBeenCalled();
  });

  it('waits on the machines before it asks to join, and closes what opens too late', async () => {
    const close = mock(() => undefined);
    let resolve: (value: JoinMachines) => void = () => undefined;
    const late = () => new Promise<JoinMachines>((done) => (resolve = done));
    const { unmount } = render(
      <TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} openMachines={late} />
    );
    expect(screen.getByText('Reading your machines').className).toContain('text-xs');
    expect(screen.getByRole('button', { name: 'Ask to join' }).hasAttribute('disabled')).toBe(true);
    unmount();
    resolve({ machines: [], setup: null, close });
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('says when your machines cannot be read, and offers to check again instead of joining', async () => {
    const failing = () => Promise.reject(new Error('Shinsa Cloud is unreachable.'));
    render(<TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} openMachines={failing} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Shinsa Cloud is unreachable.');
    expect(screen.getByRole('button', { name: 'Check again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ask to join' })).toBeNull();
  });

  it('welcomes someone already in the team, and shows a refusal on the page', async () => {
    const machines = openWith([createMachine([], 'k3x9', 'Studio', [])]);
    const request = mock(() =>
      Promise.reject(new Error('Turn on remote access on one of your machines first.'))
    );
    const { unmount } = render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={machines}
        request={request}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ask to join' }).hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Turn on remote access on one of your machines first.')).toBeTruthy();
    unmount();
    const member = mock(() => Promise.resolve({ name: 'Platform', owner: KAI, status: 'member' as const }));
    render(
      <TeamJoinPage
        link={LINK}
        dashboard={DASHBOARD}
        teamKeys={TEAM_KEYS}
        openMachines={machines}
        request={member}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Ask to join' }).hasAttribute('disabled')).toBe(false)
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('You are in Platform')).toBeTruthy();
  });
});
