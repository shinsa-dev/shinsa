import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import type { UserCommand } from '@shinsa/core';
import { type CommandRouter, createManageClient } from '../../../src/agents/manage/client.ts';
import { createProjectChanges } from '../../../src/projects/routes.ts';
import type { DispatchOptions } from '../../../src/runtime/engine.ts';
import { Engine } from '../../../src/runtime/index.ts';
import { EventLog } from '../../../src/store/index.ts';
import { createTempDir } from '../../helpers/index.ts';

const logs: EventLog[] = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
});

function createEngine() {
  const log = new EventLog(join(createTempDir(), 'events.db'));
  logs.push(log);
  return new Engine(log);
}

describe('what an agent changes through its management tools', () => {
  test('a message it sends goes through the same router as yours, on your behalf from its task', async () => {
    const routed: { command: UserCommand; options: DispatchOptions }[] = [];
    const route: CommandRouter = (command, options) => {
      routed.push({ command, options });
      return Promise.resolve([]);
    };
    const client = createManageClient({
      engine: createEngine(),
      base: 'http://127.0.0.1:1',
      key: 'agent:run:1:call:7',
      byTask: 'task-1',
      route,
    });
    const receipt = await client.send({ type: 'task.message', taskId: 'task-2', text: 'Rebase onto main.' });
    expect(receipt).toEqual({ ok: true, taskId: null });
    expect(routed).toEqual([
      {
        command: { type: 'task.message', taskId: 'task-2', text: 'Rebase onto main.' },
        options: { id: 'agent:run:1:call:7:1', onBehalf: true, byTask: 'task-1' },
      },
    ]);
  });

  test('without a router, a command it sends goes straight to the engine on your behalf', async () => {
    const engine = createEngine();
    await engine.dispatch({ type: 'project.write', project: { name: 'Basket', color: 'blue' } });
    const projectId = Object.keys(engine.state.projects)[0] ?? '';
    const client = createManageClient({ engine, base: 'http://127.0.0.1:1', key: null, byTask: 'task-1' });
    expect(await client.send({ type: 'focus.change', projectId, until: null })).toEqual({
      ok: true,
      taskId: null,
    });
    expect(engine.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual(['task-1']);
  });

  test('a folder it adds to a project is logged as done on your behalf from its task', async () => {
    const engine = createEngine();
    const home = createTempDir();
    mkdirSync(join(home, 'basket'));
    await engine.dispatch({ type: 'project.write', project: { name: 'Basket', color: 'blue' } });
    const projectId = Object.keys(engine.state.projects)[0] ?? '';
    const client = createManageClient({
      engine,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'task-1',
      projects: createProjectChanges({ engine, resolveLogin: () => Promise.resolve(null), userHome: home }),
    });
    await expect(client.projects?.upsertRepo(projectId, '~/basket')).rejects.toThrow(
      'is not a git repository.'
    );
    await client.projects?.upsertFolder(projectId, '~/basket');
    expect(engine.state.projects[projectId]?.folders).toEqual([realpathSync(join(home, 'basket'))]);
    expect(engine.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual(['task-1']);
  });
});
