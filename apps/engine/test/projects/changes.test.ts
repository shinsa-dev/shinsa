import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { listLocalRepoViews } from '../../src/projects/changes.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { runFiles } from '../harness.ts';
import { createConfigAt } from '../helpers/config.ts';
import { Engine } from '../helpers/engine.ts';
import { openEventLog, type TestEventLog } from '../helpers/event-log.ts';
import { createGitRepo, createTempDir } from '../helpers/index.ts';
import { createTestMachine } from '../helpers/machine.ts';

const logs: TestEventLog[] = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
});

function createProjectChanges(engine: Engine, userHome: string) {
  return createTestMachine(engine, createConfigAt(createTempDir(), { userHome })).projects;
}

async function setup() {
  const home = createTempDir();
  const log = openEventLog(join(createTempDir(), 'events.db'));
  logs.push(log);
  const engine = new Engine(log);
  await engine.dispatch({
    type: 'project.write',
    project: { name: 'Basket', color: 'blue', description: 'Shopping' },
  });
  const projectId = Object.keys(engine.state.projects)[0] ?? '';
  return { home, engine, log, projectId };
}

describe('a project’s repositories and folders', () => {
  test('a folder added on your behalf is logged as such, and adding it again changes nothing', async () => {
    const { home, engine, projectId } = await setup();
    mkdirSync(join(home, 'basket'));
    const changes = createProjectChanges(engine, home);
    await Effect.runPromise(
      changes.upsertFolder(projectId, '~/basket', { onBehalf: true, byTask: 'task-1' })
    );
    const again = await Effect.runPromise(
      changes.upsertFolder(projectId, '~/basket', { onBehalf: true, byTask: 'task-1' })
    );
    expect(again.project.folders).toEqual([realpathSync(join(home, 'basket'))]);
    expect(engine.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual(['task-1']);
  });

  test('a repository added on your behalf is registered as yours from that task, and records no action', async () => {
    const { home, engine, log, projectId } = await setup();
    const repo = await createGitRepo({ root: home, name: 'basket', remote: false });
    const changes = createProjectChanges(engine, home);
    const { repo: added } = await Effect.runPromise(
      changes.upsertRepo(projectId, repo.path, { onBehalf: true, byTask: 'task-1' })
    );
    expect(added.projectId).toBe(projectId);
    expect(log.readEvents().events.find((event) => event.type === 'repo.registered')).toMatchObject({
      onBehalf: true,
      byTask: 'task-1',
    });
    expect(engine.state.onBehalfActions).toEqual([]);
  });

  test('a change the engine fails to record fails with its reason', async () => {
    const { home, engine, projectId } = await setup();
    mkdirSync(join(home, 'shelf'));
    const broken = {
      core: { ...engine.core, dispatch: () => Effect.fail(new EngineStopped({ message: 'log closed' })) },
    } as unknown as typeof engine;
    const changes = createProjectChanges(broken, home);
    const failure = await Effect.runPromise(Effect.flip(changes.upsertFolder(projectId, '~/shelf')));
    expect(failure).toMatchObject({ _tag: 'EngineStopped', message: 'log closed' });
  });

  test('a refusal from the engine passes through as its own error', async () => {
    const { home, engine, projectId } = await setup();
    mkdirSync(join(home, 'shelf'));
    const refusing = {
      core: {
        ...engine.core,
        dispatch: () =>
          Effect.fail(new DomainError({ code: 'project_not_found', message: 'No such project.' })),
      },
    } as unknown as typeof engine;
    const changes = createProjectChanges(refusing, home);
    const failure = await Effect.runPromise(Effect.flip(changes.upsertFolder(projectId, '~/shelf')));
    expect(failure).toMatchObject({ _tag: 'DomainError', code: 'project_not_found' });
  });

  test('a missing project and a path that is not a folder are refused', async () => {
    const { home, engine, projectId } = await setup();
    const changes = createProjectChanges(engine, home);
    expect(await Effect.runPromise(Effect.flip(changes.upsertFolder('nope', '~/shelf')))).toMatchObject({
      _tag: 'DomainError',
      code: 'project_not_found',
    });
    expect(await Effect.runPromise(Effect.flip(changes.upsertFolder(projectId, 'relative')))).toMatchObject({
      _tag: 'DomainError',
      code: 'folder_invalid',
    });
  });

  test('the local repositories are the registered ones and those in the chosen and project folders', async () => {
    const { home, engine, projectId } = await setup();
    const chosen = createTempDir();
    const loose = await createGitRepo({ root: chosen, name: 'loose', remote: false });
    const inside = await createGitRepo({ root: home, name: 'basket', remote: false });
    await Effect.runPromise(createProjectChanges(engine, home).upsertFolder(projectId, home));
    expect(
      (await runFiles(listLocalRepoViews(engine.state, [chosen]))).map(({ name, repoId, projectId: id }) => [
        name,
        repoId,
        id,
      ])
    ).toEqual([
      ['basket', null, projectId],
      ['loose', null, null],
    ]);
    const { repo } = await Effect.runPromise(
      createProjectChanges(engine, home).upsertRepo(projectId, inside.path)
    );
    expect(await runFiles(listLocalRepoViews(engine.state, [chosen]))).toEqual([
      { path: repo.path, name: 'basket', repoId: repo.id, projectId },
      { path: realpathSync(loose.path), name: 'loose', repoId: null, projectId: null },
    ]);
  });
});
