import { join } from 'node:path';
import { Effect, FileSystem, Option } from 'effect';
import type { Engine } from '../../apps/engine/test/helpers/engine.ts';
import {
  listInitiativeTeamMembers,
  listTeamTasks,
  resolveTaskProject,
  type Task,
} from '../../packages/core/src/index.ts';
import { SandboxFailed, type SeedProject, TEAMMATE, TEAMMATE_INITIATIVE_TASK } from './schema.ts';
import { TEAM } from './team.ts';

export const seedProject = Effect.fn('Sandbox.seedProject')(function* (
  engine: Engine,
  dataDir: string,
  seed: SeedProject
) {
  const { core } = engine;
  const repoPath = join(dataDir, '..', seed.repo);
  const fs = yield* FileSystem.FileSystem;
  yield* fs
    .makeDirectory(repoPath, { recursive: true })
    .pipe(
      Effect.mapError(
        (error) => new SandboxFailed({ message: `Making ${repoPath} failed: ${error.message}` })
      )
    );
  yield* core.dispatch({
    type: 'repo.register',
    repo: { name: seed.repo, path: repoPath, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: seed.project,
  });
  const repo = Object.values((yield* core.state).repos).find((entry) => entry.name === seed.repo);
  if (!repo) return yield* new SandboxFailed({ message: `Registering ${seed.repo} failed.` });
  for (const task of seed.tasks) {
    const actor = task.owner
      ? { login: task.owner.login, name: task.owner.name, avatarUrl: task.owner.avatarUrl }
      : null;
    yield* core.dispatch({ type: 'task.create', request: task.request, repoId: repo.id }, { actor });
    const created = Object.values((yield* core.state).tasks).find((entry) => entry.request === task.request);
    if (!created) return yield* new SandboxFailed({ message: `Creating a ${seed.project} task failed.` });
    yield* core.dispatch({
      type: 'task.triage',
      taskId: created.id,
      title: task.title,
      repoId: repo.id,
      size: 'small',
      branch: task.branch,
      waitsOn: [],
    });
  }
  return repo;
});

export const shareMachine = Effect.fn('Sandbox.shareMachine')(function* (engine: Engine) {
  yield* engine.core.dispatch({ type: 'settings.change', patch: { sharedTeams: [TEAM.id] } });
});

export const shareProjectWithTeam = Effect.fn('Sandbox.shareProjectWithTeam')(function* (
  engine: Engine,
  projectId: string | undefined
) {
  if (!projectId) return yield* new SandboxFailed({ message: 'No project to share with the preview team.' });
  yield* engine.core.dispatch({ type: 'project.add_to_team', projectId, teamId: TEAM.id });
});

export const joinTeammateInitiative = Effect.fn('Sandbox.joinTeammateInitiative')(function* (
  teammate: Engine,
  studio: Engine
) {
  const initiative = Object.values((yield* studio.core.state).initiatives ?? {}).find(
    (entry) => entry.name === 'Chat split'
  );
  const task = Object.values((yield* teammate.core.state).tasks).find(
    (entry) => entry.request === TEAMMATE_INITIATIVE_TASK
  );
  if (!(initiative && task))
    return yield* new SandboxFailed({ message: 'No Chat split or teammate task to join it with.' });
  yield* studio.core.dispatch({
    type: 'initiative.add_to_team',
    initiativeId: initiative.id,
    teamId: TEAM.id,
  });
  yield* teammate.core.dispatch(
    {
      type: 'task.join_initiative',
      taskId: task.id,
      initiativeId: initiative.id,
      phaseId: initiative.phases[0]?.id ?? null,
      team: { teamId: TEAM.id, instanceId: 'studio', name: initiative.name },
    },
    { actor: { login: TEAMMATE.login, name: TEAMMATE.name, avatarUrl: TEAMMATE.avatarUrl } }
  );
  const tasks = listTeamTasks(yield* teammate.core.state, TEAM.id, {
    owner: TEAMMATE.login,
    ownerProfile: { name: TEAMMATE.name, avatarUrl: TEAMMATE.avatarUrl },
    machine: 'Kai’s MacBook',
  });
  yield* studio.core.dispatch({
    type: 'initiative.record_team_members',
    initiativeId: initiative.id,
    teamId: TEAM.id,
    members: listInitiativeTeamMembers(initiative, 'studio', { teamId: TEAM.id, instanceId: 'kai', tasks }),
  });
});

export const seedTeammateDuplicate = Effect.fn('Sandbox.seedTeammateDuplicate')(function* (
  engine: Engine,
  projectId: string | undefined,
  original: Task | undefined
) {
  const { core } = engine;
  const repo = Object.values((yield* core.state).repos).find((entry) => entry.projectId === projectId);
  if (!(repo && original))
    return yield* new SandboxFailed({ message: 'No project or teammate task for the teammate duplicate.' });
  const request = 'Let people copy a paywall from the list, products and copy included';
  yield* core.dispatch({ type: 'task.create', request, repoId: repo.id });
  const created = Object.values((yield* core.state).tasks).find((entry) => entry.request === request);
  if (!created) return yield* new SandboxFailed({ message: 'Creating the teammate duplicate failed.' });
  yield* core.dispatch({
    type: 'task.triage',
    taskId: created.id,
    title: 'Copy a paywall from the list',
    repoId: repo.id,
    size: 'small',
    branch: 'feat/copy-paywall',
    waitsOn: [],
    duplicateOfTeammate: {
      teamId: TEAM.id,
      machineId: 'kai',
      taskId: original.id,
      handle: original.handle ?? null,
      title: original.title,
      owner: { login: TEAMMATE.login, name: TEAMMATE.name, avatarUrl: TEAMMATE.avatarUrl },
    },
    reasons: { duplicate: 'Kai is already adding a Duplicate action to the paywall menu.' },
  });
  return (yield* core.state).tasks[created.id] ?? created;
});

export const selectBusiestProject = Effect.fn('Sandbox.selectBusiestProject')(function* (engine: Engine) {
  const state = yield* engine.core.state;
  const counts = new Map<string, number>();
  for (const task of Object.values(state.tasks)) {
    const projectId = Option.getOrNull(resolveTaskProject(state, task));
    if (projectId && !task.watchHome) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
});
