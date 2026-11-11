import { describe, expect, test } from 'bun:test';
import {
  isTeamTask,
  listTeamInitiatives,
  listTeamProjectIds,
  listTeamTasks,
  TEAM_SETTLED_LIMIT,
} from '../../src/index.ts';
import {
  approve,
  createHarness,
  createInitiative,
  createTask,
  type Harness,
  reachReviewGate,
  registerRepo,
} from '../harness.ts';

const CONTEXT = {
  owner: 'octocat',
  ownerProfile: { name: 'Octo Cat', avatarUrl: 'https://avatars.example/octocat' },
  machine: 'Studio',
};

function teamRepo(harness: Harness, name: string, projectName: string) {
  const repoId = registerRepo(harness, name, projectName);
  const projectId = harness.state.repos[repoId]?.projectId ?? '';
  return { repoId, projectId };
}

describe('the team task list', () => {
  test('lists the tasks of team projects, redacted, with their owner, machine and repository', () => {
    const harness = createHarness();
    const shared = teamRepo(harness, 'paywall-next', 'Superwall');
    const own = teamRepo(harness, 'shinsa', 'Personal');
    harness.send({ type: 'project.add_to_team', projectId: shared.projectId, teamId: 'team-1' });
    const inTeam = createTask(harness, { repoId: shared.repoId, request: 'Add euro prices' });
    const outside = createTask(harness, { repoId: own.repoId });
    expect(listTeamProjectIds(harness.state, 'team-1')).toEqual([shared.projectId]);
    expect(isTeamTask(harness.state, harness.task(inTeam), 'team-1')).toBe(true);
    expect(isTeamTask(harness.state, harness.task(outside), 'team-1')).toBe(false);
    expect(isTeamTask(harness.state, harness.task(inTeam), 'team-2')).toBe(false);
    const [listed, ...rest] = listTeamTasks(harness.state, 'team-1', CONTEXT);
    expect(rest).toEqual([]);
    expect(listed).toMatchObject({
      owner: 'octocat',
      ownerProfile: { name: 'Octo Cat', avatarUrl: 'https://avatars.example/octocat' },
      machine: 'Studio',
      project: { id: shared.projectId },
    });
    expect(listed?.task).toMatchObject({ id: inTeam, worktreePath: null, note: null, waitsOn: [] });
    expect(listed?.task).not.toHaveProperty('share');
    expect(listed?.project).toMatchObject({ description: '', folders: [] });
    expect(listed?.project).not.toHaveProperty('teamIds');
    expect(listed?.repo).toMatchObject({ id: shared.repoId, name: 'paywall-next', path: '' });
    expect(listed?.gates.every((gate) => gate.taskId === inTeam && gate.response === null)).toBe(true);
  });

  test('a project that leaves the team takes its tasks with it', () => {
    const harness = createHarness();
    const shared = teamRepo(harness, 'paywall-next', 'Superwall');
    harness.send({ type: 'project.add_to_team', projectId: shared.projectId, teamId: 'team-1' });
    const taskId = createTask(harness, { repoId: shared.repoId });
    harness.send({ type: 'project.remove_from_team', projectId: shared.projectId, teamId: 'team-1' });
    expect(listTeamTasks(harness.state, 'team-1', CONTEXT)).toEqual([]);
    expect(isTeamTask(harness.state, harness.task(taskId), 'team-1')).toBe(false);
  });

  test('keeps every open task and only the most recent finished ones', () => {
    const harness = createHarness();
    const shared = teamRepo(harness, 'paywall-next', 'Superwall');
    harness.send({ type: 'project.add_to_team', projectId: shared.projectId, teamId: 'team-1' });
    const open = createTask(harness, { repoId: shared.repoId });
    const finished: string[] = [];
    for (let index = 0; index <= TEAM_SETTLED_LIMIT; index++) {
      const taskId = createTask(harness, { repoId: shared.repoId });
      harness.advance(1_000);
      harness.send({ type: 'task.cancel', taskId });
      finished.push(taskId);
    }
    const listed = listTeamTasks(harness.state, 'team-1', CONTEXT).map((entry) => entry.task.id);
    expect(listed).toHaveLength(TEAM_SETTLED_LIMIT + 1);
    expect(listed[0]).toBe(open);
    expect(listed[1]).toBe(finished.at(-1));
    expect(listed).not.toContain(finished[0]);
  });

  test('lists each task with its own gates, without the answers given at them', () => {
    const harness = createHarness();
    const shared = teamRepo(harness, 'paywall-next', 'Superwall');
    harness.send({ type: 'project.add_to_team', projectId: shared.projectId, teamId: 'team-1' });
    const taskId = createTask(harness, { repoId: shared.repoId });
    reachReviewGate(harness, taskId);
    approve(harness, taskId, 'Ship it, and keep the old prices.');
    const other = createTask(harness, { repoId: shared.repoId });
    reachReviewGate(harness, other);
    const listed = listTeamTasks(harness.state, 'team-1', CONTEXT);
    const gates = (id: string) => listed.find((entry) => entry.task.id === id)?.gates ?? [];
    expect(gates(taskId).length).toBeGreaterThan(0);
    expect(gates(taskId).every((gate) => gate.taskId === taskId && gate.response === null)).toBe(true);
    expect(gates(other).every((gate) => gate.taskId === other)).toBe(true);
    expect(gates(other).length).toBeGreaterThan(0);
  });

  test('an automation is never a team task', () => {
    const harness = createHarness();
    const shared = teamRepo(harness, 'paywall-next', 'Superwall');
    harness.send({ type: 'project.add_to_team', projectId: shared.projectId, teamId: 'team-1' });
    const taskId = createTask(harness, { repoId: shared.repoId });
    expect(isTeamTask(harness.state, { ...harness.task(taskId), watchHome: true }, 'team-1')).toBe(false);
  });
});

describe('an initiative shared with a team', () => {
  test('lists its lead task as a team task, but not its members outside the team’s projects', () => {
    const harness = createHarness();
    const { initiativeId, leadId } = createInitiative(harness, { phases: ['Dock host'] });
    const member = createTask(harness);
    harness.send({ type: 'task.join_initiative', taskId: member, initiativeId, phaseId: null });
    expect(isTeamTask(harness.state, harness.task(leadId), 'team-1')).toBe(false);
    harness.send({ type: 'initiative.add_to_team', initiativeId, teamId: 'team-1' });
    expect(isTeamTask(harness.state, harness.task(leadId), 'team-1')).toBe(true);
    expect(isTeamTask(harness.state, harness.task(leadId), 'team-2')).toBe(false);
    expect(isTeamTask(harness.state, harness.task(member), 'team-1')).toBe(false);
    expect(listTeamTasks(harness.state, 'team-1', CONTEXT).map((entry) => entry.task.id)).toEqual([leadId]);
  });

  test('lists the initiative for the team, open or finished, and nothing once it leaves the team', () => {
    const harness = createHarness();
    const { initiativeId, leadId } = createInitiative(harness, { phases: ['Dock host'] });
    expect(listTeamInitiatives(harness.state, 'team-1')).toEqual([]);
    harness.send({ type: 'initiative.add_to_team', initiativeId, teamId: 'team-1' });
    const initiative = harness.state.initiatives[initiativeId];
    expect(listTeamInitiatives(harness.state, 'team-1')).toEqual([
      {
        id: initiativeId,
        name: 'Chat split',
        description: '',
        phases: initiative?.phases ?? [],
        leadTaskId: leadId,
        report: null,
        finished: false,
        updatedAt: initiative?.updatedAt ?? 0,
      },
    ]);
    const lead = harness.task(leadId);
    const finished = {
      ...harness.state,
      tasks: { ...harness.state.tasks, [leadId]: { ...lead, stage: 'done' as const } },
    };
    expect(listTeamInitiatives(finished, 'team-1')[0]?.finished).toBe(true);
    const leaderless = { ...harness.state, tasks: { ...harness.state.tasks, [leadId]: undefined } };
    expect(listTeamInitiatives(leaderless as typeof harness.state, 'team-1')).toEqual([]);
    harness.send({ type: 'initiative.remove_from_team', initiativeId, teamId: 'team-1' });
    expect(listTeamInitiatives(harness.state, 'team-1')).toEqual([]);
    expect(isTeamTask(harness.state, harness.task(leadId), 'team-1')).toBe(false);
  });
});
