import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectChanges } from '../../src/projects/changes.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog } from '../../src/store/index.ts';
import { createGitRepo, createTempDir } from '../helpers/index.ts';

const logs: EventLog[] = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
});

async function setup() {
  const home = createTempDir();
  const log = new EventLog(join(createTempDir(), 'events.db'));
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
    const changes = createProjectChanges({
      engine,
      resolveLogin: () => Promise.resolve(null),
      userHome: home,
    });
    await changes.upsertFolder(projectId, '~/basket', { onBehalf: true, byTask: 'task-1' });
    const again = await changes.upsertFolder(projectId, '~/basket', { onBehalf: true, byTask: 'task-1' });
    expect(again.project.folders).toEqual([realpathSync(join(home, 'basket'))]);
    expect(engine.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual(['task-1']);
  });

  test('a repository added on your behalf is registered as yours from that task, and records no action', async () => {
    const { home, engine, log, projectId } = await setup();
    const repo = await createGitRepo({ root: home, name: 'basket', remote: false });
    const changes = createProjectChanges({
      engine,
      resolveLogin: () => Promise.resolve(null),
      userHome: home,
    });
    const { repo: added } = await changes.upsertRepo(projectId, repo.path, {
      onBehalf: true,
      byTask: 'task-1',
    });
    expect(added.projectId).toBe(projectId);
    expect(log.readEvents().events.find((event) => event.type === 'repo.registered')).toMatchObject({
      onBehalf: true,
      byTask: 'task-1',
    });
    expect(engine.state.onBehalfActions).toEqual([]);
  });
});
