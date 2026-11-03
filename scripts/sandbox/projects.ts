import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Engine } from '../../apps/engine/src/runtime/index.ts';
import { resolveTaskProject, type Task } from '../../packages/core/src/index.ts';
import { type SeedProject, TEAMMATE } from './schema.ts';
import { TEAM } from './team.ts';

export async function seedProject(engine: Engine, dataDir: string, seed: SeedProject) {
  const path = join(dataDir, '..', seed.repo);
  mkdirSync(path, { recursive: true });
  await engine.dispatch({
    type: 'repo.register',
    repo: { name: seed.repo, path, defaultBranch: 'main', remote: null, checkCommands: [] },
    projectName: seed.project,
  });
  const repo = Object.values(engine.state.repos).find((entry) => entry.name === seed.repo);
  if (!repo) throw new Error(`Registering ${seed.repo} failed.`);
  for (const task of seed.tasks) {
    await engine.dispatch({ type: 'task.create', request: task.request, repoId: repo.id });
    const created = Object.values(engine.state.tasks).find((entry) => entry.request === task.request);
    if (!created) throw new Error(`Creating a ${seed.project} task failed.`);
    await engine.dispatch({
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
}

export async function shareProjectWithTeam(engine: Engine, projectId: string | undefined) {
  if (!projectId) throw new Error('No project to share with the preview team.');
  await engine.dispatch({ type: 'project.add_to_team', projectId, teamId: TEAM.id });
}

export async function seedTeammateDuplicate(
  engine: Engine,
  projectId: string | undefined,
  original: Task | undefined
) {
  const repo = Object.values(engine.state.repos).find((entry) => entry.projectId === projectId);
  if (!(repo && original)) throw new Error('No project or teammate task for the teammate duplicate.');
  const request = 'Let people copy a paywall from the list, products and copy included';
  await engine.dispatch({ type: 'task.create', request, repoId: repo.id });
  const created = Object.values(engine.state.tasks).find((entry) => entry.request === request);
  if (!created) throw new Error('Creating the teammate duplicate failed.');
  await engine.dispatch({
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
  return engine.state.tasks[created.id] ?? created;
}

export function selectBusiestProject(engine: Engine) {
  const counts = new Map<string, number>();
  for (const task of Object.values(engine.state.tasks)) {
    const projectId = resolveTaskProject(engine.state, task);
    if (projectId && !task.watchHome) counts.set(projectId, (counts.get(projectId) ?? 0) + 1);
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
}
