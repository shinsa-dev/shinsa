import { describe, expect, test } from 'bun:test';
import { parseUserCommand } from '../../src/index.ts';
import { createHarness, type Harness, registerRepo } from '../harness.ts';

function teamProject(harness: Harness) {
  const repoId = registerRepo(harness);
  return harness.state.repos[repoId]?.projectId ?? '';
}

describe('a project in a team', () => {
  test('adds a team once and removes it once, keeping the other teams', () => {
    const harness = createHarness();
    const projectId = teamProject(harness);
    harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' });
    harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-2' });
    expect(harness.state.projects[projectId]?.teamIds).toEqual(['team-1', 'team-2']);
    const events = harness.state.seq;
    harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' });
    expect(harness.state.seq).toBe(events);
    harness.send({ type: 'project.remove_from_team', projectId, teamId: 'team-1' });
    expect(harness.state.projects[projectId]?.teamIds).toEqual(['team-2']);
    harness.send({ type: 'project.remove_from_team', projectId, teamId: 'team-1' });
    expect(harness.state.seq).toBe(events + 1);
  });

  test('leaving its last team drops the field, and saving the project keeps its teams', () => {
    const harness = createHarness();
    const projectId = teamProject(harness);
    harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' });
    const project = harness.state.projects[projectId];
    harness.send({
      type: 'project.write',
      project: { id: projectId, name: 'Renamed', color: project?.color ?? 'blue' },
    });
    expect(harness.state.projects[projectId]).toMatchObject({ name: 'Renamed', teamIds: ['team-1'] });
    harness.send({ type: 'project.remove_from_team', projectId, teamId: 'team-1' });
    expect(harness.state.projects[projectId]).not.toHaveProperty('teamIds');
  });

  test('only the human chooses what a team sees', () => {
    const harness = createHarness();
    const projectId = teamProject(harness);
    const refusal = 'Only the human decides which projects a team sees.';
    expect(() =>
      harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' }, { onBehalf: true })
    ).toThrow(refusal);
    harness.send({ type: 'project.add_to_team', projectId, teamId: 'team-1' });
    expect(() =>
      harness.send({ type: 'project.remove_from_team', projectId, teamId: 'team-1' }, { onBehalf: true })
    ).toThrow(refusal);
    expect(harness.state.projects[projectId]?.teamIds).toEqual(['team-1']);
  });

  test('a missing project is refused, and both commands parse from the wire', () => {
    const harness = createHarness();
    expect(() => harness.send({ type: 'project.add_to_team', projectId: 'gone', teamId: 't' })).toThrow(
      'No project gone'
    );
    expect(() => harness.send({ type: 'project.remove_from_team', projectId: 'gone', teamId: 't' })).toThrow(
      'No project gone'
    );
    for (const type of ['project.add_to_team', 'project.remove_from_team'] as const) {
      expect(parseUserCommand({ type, projectId: 'p', teamId: 't' })).toEqual({
        type,
        projectId: 'p',
        teamId: 't',
      });
      expect(() => parseUserCommand({ type, projectId: 'p' })).toThrow();
    }
  });
});
