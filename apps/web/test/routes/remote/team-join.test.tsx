import { afterEach, describe, expect, it, mock } from 'bun:test';
import { fireEvent, render, screen } from '@testing-library/react';
import { stashTeamJoinFragment } from '@/lib/teams/join.ts';
import { TeamJoinPage } from '@/routes/remote/team-join.tsx';

const KEY = 'A'.repeat(43);

const LINK = { teamId: 'team1', invite: 'invite-1', key: KEY };

const TEAM_KEYS = { selectTeamKey: () => Promise.resolve(null), writeTeamKey: () => Promise.resolve() };

const DASHBOARD = { joinTeam: () => Promise.reject(new Error('unused')) };

afterEach(() => sessionStorage.clear());

describe('the team join page on app.shinsa.dev', () => {
  it('says an incomplete link cannot add you', () => {
    render(<TeamJoinPage link={null} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} />);
    expect(screen.getByText('This link cannot add you to a team')).toBeTruthy();
  });

  it('says what a teammate sees, asks to join, and says who answers', async () => {
    stashTeamJoinFragment(sessionStorage, `#team1.invite-1.${KEY}`);
    const request = mock(() =>
      Promise.resolve({ name: 'Platform', owner: 'Kai Lane', status: 'requested' as const })
    );
    render(<TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} request={request} />);
    expect(screen.getByText('Read-only, and never the chat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('Request sent')).toBeTruthy();
    expect(screen.getByText(/Kai Lane accepts or declines your request to join Platform/)).toBeTruthy();
    expect(screen.getByText('Choose Join a team and paste this link.')).toBeTruthy();
    expect(screen.getByText(`${location.origin}/share/team#team1.invite-1.${KEY}`)).toBeTruthy();
    expect(sessionStorage.length).toBe(0);
  });

  it('welcomes someone already in the team, and shows a refusal on the page', async () => {
    const request = mock(() => Promise.reject(new Error('This team link was turned off.')));
    const { unmount } = render(
      <TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} request={request} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('This team link was turned off.')).toBeTruthy();
    unmount();
    const member = mock(() =>
      Promise.resolve({ name: 'Platform', owner: 'Kai Lane', status: 'member' as const })
    );
    render(<TeamJoinPage link={LINK} dashboard={DASHBOARD} teamKeys={TEAM_KEYS} request={member} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask to join' }));
    expect(await screen.findByText('You are in Platform')).toBeTruthy();
  });
});
