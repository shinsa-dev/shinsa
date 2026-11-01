import { describe, expect, it } from 'bun:test';
import {
  createSampleTeamActions,
  createSampleTeams,
  openSampleJoinMachines,
  requestSampleTeamJoin,
  SAMPLE_TEAM_JOIN_DASHBOARD,
} from '@/routes/ui/sample-teams.ts';

const NOW = 1_800_000_000_000;

const REFUSED = 'This is a sample. Nothing changes here.';

describe('the /ui teams samples', () => {
  it('show a team you own, one you are in and a request you sent, then no team and remote access off', () => {
    const { state, scenes } = createSampleTeams(NOW);
    expect(Object.values(state.projects).map((project) => project.teamIds)).toEqual([
      ['tm4k2q'],
      ['tm4k2q'],
      ['tm8r1v'],
      [],
    ]);
    expect(scenes.map((scene) => scene.snapshot.teams.map((team) => team.status))).toEqual([
      ['member', 'member', 'requested'],
      [],
      [],
    ]);
  });

  it('give the join link and refuse every change', async () => {
    const actions = createSampleTeamActions();
    expect((await actions.readLink('tm4k2q')).url).toStartWith('https://app.shinsa.dev/share/team#tm4k2q.');
    for (const refused of [
      actions.create,
      actions.join,
      actions.writeProjects,
      actions.removeLink,
      actions.acceptRequest,
      actions.declineRequest,
      actions.removeMember,
      actions.leave,
      actions.remove,
      actions.grantAccess,
    ])
      await expect((refused as () => Promise<unknown>)()).rejects.toThrow(REFUSED);
  });

  it('send a join request, preview its team and list the machines that could share projects', async () => {
    expect(await requestSampleTeamJoin()).toMatchObject({ name: 'Platform', status: 'requested' });
    expect(await SAMPLE_TEAM_JOIN_DASHBOARD.previewTeam()).toMatchObject({ name: 'Platform' });
    await expect(SAMPLE_TEAM_JOIN_DASHBOARD.joinTeam()).rejects.toThrow('This is a sample.');
    const machines = await openSampleJoinMachines();
    expect(machines.machines.map((machine) => machine.name)).toContain('Studio');
    await Promise.all(
      machines.machines.map((machine) => machine.share('https://app.shinsa.dev/share/team#t.i.k', []))
    );
    machines.close();
  });
});
