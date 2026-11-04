import { afterEach, describe, expect, it } from 'bun:test';
import { ACCESS_PRESETS } from '@shinsa/core';
import { TooltipProvider } from '@shinsa/ui/components/tooltip';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HostedTeamsGroup } from '@/components/settings/hosted-teams.tsx';
import { isOwnMachineConnecting } from '@/components/settings/machines.tsx';
import { MachineTeamsSettings } from '@/components/settings/teams.tsx';
import { TEAM_KEY_MISSING, TEAMS_CONNECTING } from '@/lib/teams/settings.ts';
import { createShinsaState } from '../../support/state.ts';
import { createTeam, KAI, MONA } from '../../support/teams.ts';

afterEach(cleanup);

function renderHosted(team = createTeam(), hasKey = true) {
  render(
    <TooltipProvider>
      <HostedTeamsGroup teams={{ viewerId: MONA.id, teams: [{ team, hasKey }] }} failure={null} />
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

  it('counts an online machine of yours this browser reaches but has not heard from yet as connecting', () => {
    const row = (id: string, role: string, waiting = false) =>
      ({ instance: { id, role, online: true }, device: { waiting } }) as unknown as Parameters<
        typeof isOwnMachineConnecting
      >[0][number];
    const reached = [{ id: 'studio' }] as unknown as Parameters<typeof isOwnMachineConnecting>[1];
    expect(isOwnMachineConnecting([row('studio', 'owner')], [])).toBe(true);
    expect(isOwnMachineConnecting([row('studio', 'owner')], reached)).toBe(false);
    expect(isOwnMachineConnecting([row('studio', 'owner', true)], [])).toBe(false);
    expect(isOwnMachineConnecting([row('kai-mac', 'teammate')], [])).toBe(false);
  });
});
