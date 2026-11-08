import { afterEach, describe, expect, it, mock } from 'bun:test';
import { ACCESS_PRESETS, type AccessScopes } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { HostedTeamsGroup } from '@/components/settings/hosted-teams.tsx';
import { MachineTeamsSettings } from '@/components/settings/teams.tsx';
import { replaceHostedTeam, TEAM_KEY_MISSING, TEAMS_CONNECTING } from '@/lib/teams/settings.ts';
import { createShinsaState } from '../../support/state.ts';
import { createTeam, KAI, MONA } from '../../support/teams.ts';

afterEach(cleanup);

type Update = (teamId: string, userId: string | null, scopes: AccessScopes | null) => Promise<unknown>;

function renderHosted(team = createTeam(), hasKey = true, onUpdate: Update | null = null) {
  render(
    <TooltipProvider>
      <HostedTeamsGroup
        teams={{ viewerId: MONA.id, teams: [{ team, hasKey }] }}
        failure={null}
        onUpdate={onUpdate}
      />
    </TooltipProvider>
  );
}

describe('Settings → Teams on a browser that reaches none of your machines', () => {
  it('shows the team’s scopes and who has their own, and says where to change them', () => {
    renderHosted(createTeam({ overrides: [{ userId: KAI.id, scopes: ACCESS_PRESETS.full }] }));
    fireEvent.click(screen.getByText('What teammates can do'));
    expect(screen.getByText('Collaborate')).toBeTruthy();
    expect(screen.getByText('Add one of your machines to this browser to change these.')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: 'Fork tasks' }) as HTMLElement).getAttribute('aria-disabled')
    ).toBe('true');
    expect(screen.queryByRole('combobox', { name: 'Preset for the team' })).toBeNull();
    fireEvent.click(screen.getByText('People'));
    expect(screen.getByText(/Own scopes/)).toBeTruthy();
  });

  it('lists every machine in the team with its owner and status', () => {
    renderHosted(
      createTeam({
        machines: [
          { id: 'm1', name: 'Mac.lan', userId: KAI.id, online: true, lastSeenAt: Date.now() },
          { id: 'm2', name: 'Studio', userId: MONA.id, online: false, lastSeenAt: null },
        ],
      })
    );
    expect(screen.getByText('Mac.lan')).toBeTruthy();
    expect(screen.getByText('Studio')).toBeTruthy();
    expect(screen.getAllByText(/^Owned by/)).toHaveLength(2);
    expect(screen.getByText('Online')).toBeTruthy();
    expect(screen.getByText('Never connected')).toBeTruthy();
  });

  it('says when no one in the team has turned on remote access', () => {
    renderHosted(createTeam({ machines: [] }));
    expect(screen.getByText('No one in this team has turned on remote access yet.')).toBeTruthy();
  });

  it('lets the owner change the team’s scopes and one person’s from the page', async () => {
    const onUpdate = mock<Update>(() => Promise.resolve());
    renderHosted(createTeam(), true, onUpdate);
    fireEvent.click(screen.getByText('What teammates can do'));
    expect(screen.queryByText('Add one of your machines to this browser to change these.')).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Fork tasks' }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate.mock.calls[0]?.[1]).toBeNull();
    expect(onUpdate.mock.calls[0]?.[2]).not.toContain('fork');
    fireEvent.click(screen.getByText('People'));
    fireEvent.click(screen.getByRole('button', { name: 'Scopes' }));
    expect(screen.getByText('What Kai can do')).toBeTruthy();
  });

  it('keeps the edit buttons off a team someone else owns', () => {
    renderHosted(
      createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 1 }] }),
      true,
      () => Promise.resolve()
    );
    fireEvent.click(screen.getByText('People'));
    expect(screen.queryByRole('button', { name: 'Scopes' })).toBeNull();
  });

  it('puts the answered team in place of the old one', () => {
    const team = createTeam();
    const other = createTeam({ id: 'other' });
    const changed = { ...team, scopes: ACCESS_PRESETS.status };
    const next = replaceHostedTeam(
      {
        viewerId: MONA.id,
        teams: [
          { team, hasKey: true },
          { team: other, hasKey: false },
        ],
      },
      changed
    );
    expect(next.teams.map((entry) => entry.team)).toEqual([changed, other]);
  });

  it('tells a member only the owner changes them', () => {
    renderHosted(createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 1 }] }));
    fireEvent.click(screen.getByText('What teammates can do'));
    expect(screen.getByText('Only Kai Lane changes these.')).toBeTruthy();
  });

  it('leaves the join link note off a team you own, since your machine brings its key', () => {
    renderHosted(createTeam(), false);
    expect(screen.queryByText(TEAM_KEY_MISSING)).toBeNull();
  });

  it('asks for the join link on a team you are in without its key', () => {
    renderHosted(createTeam({ owner: KAI, role: 'member', members: [{ user: MONA, addedAt: 1 }] }), false);
    expect(screen.getByText(TEAM_KEY_MISSING)).toBeTruthy();
  });

  it('waits for a machine of yours that is still connecting instead of falling back', () => {
    render(<MachineTeamsSettings state={createShinsaState({})} machines={[]} connecting />);
    expect(screen.getByText(TEAMS_CONNECTING)).toBeTruthy();
    expect(screen.queryByText('What teammates can do')).toBeNull();
  });
});
