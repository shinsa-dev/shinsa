import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DomainError, type UserCommand } from '@shinsa/core';
import { Effect } from 'effect';
import { type CommandRouter, createManageClient } from '../../../src/agents/manage/client.ts';
import type { DispatchOptions } from '../../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../../src/runtime/engine/service.ts';
import { createConfigAt } from '../../helpers/config.ts';
import { createStubEngineCoreLayer } from '../../helpers/engine-core.ts';
import { Engine } from '../../helpers/engine.ts';
import { openEventLog, type TestEventLog } from '../../helpers/event-log.ts';
import { createTempDir } from '../../helpers/index.ts';
import { createTestMachine } from '../../helpers/machine.ts';
import { createStubEngine } from '../../helpers/state.ts';

const logs: TestEventLog[] = [];

afterEach(() => {
  for (const log of logs.splice(0)) log.close();
});

function createEngine() {
  const log = openEventLog(join(createTempDir(), 'events.db'));
  logs.push(log);
  return new Engine(log);
}

describe('what an agent changes through its management tools', () => {
  test('a message it sends goes through the same router as yours, on your behalf from its task', async () => {
    const routed: { command: UserCommand; options: DispatchOptions }[] = [];
    const route: CommandRouter = (command, options) => {
      routed.push({ command, options });
      return Effect.succeed([]);
    };
    const client = createManageClient({
      engine: createEngine().core,
      base: 'http://127.0.0.1:1',
      key: 'agent:run:1:call:7',
      byTask: 'task-1',
      route,
    });
    const receipt = await Effect.runPromise(
      client.send({ type: 'task.message', taskId: 'task-2', text: 'Rebase onto main.' })
    );
    expect(receipt).toEqual({ ok: true, taskId: null });
    expect(routed).toEqual([
      {
        command: { type: 'task.message', taskId: 'task-2', text: 'Rebase onto main.' },
        options: { id: 'agent:run:1:call:7:1', onBehalf: true, byTask: 'task-1' },
      },
    ]);
  });

  test('a command that does not parse is refused with its code and routes nothing', async () => {
    const routed: UserCommand[] = [];
    const client = createManageClient({
      engine: createEngine().core,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'task-1',
      route: (command) => {
        routed.push(command);
        return Effect.succeed([]);
      },
    });
    const refusal = await Effect.runPromise(
      Effect.flip(client.send({ type: 'task.message', taskId: 7, text: 'Rebase.' } as never))
    );
    expect(refusal).toBeInstanceOf(DomainError);
    expect(refusal).toMatchObject({ code: 'command_invalid', message: 'taskId must be text.' });
    expect(routed).toEqual([]);
  });

  test('a router that fails passes its reason back to the agent', async () => {
    const client = createManageClient({
      engine: createEngine().core,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'task-1',
      route: () =>
        Effect.fail(new DomainError({ code: 'classifier_failed', message: 'The classifier is down.' })),
    });
    await expect(
      Effect.runPromise(client.send({ type: 'task.message', taskId: 'task-2', text: 'Rebase.' }))
    ).rejects.toThrow('The classifier is down.');
  });

  test('without a router, a command it sends goes straight to the engine on your behalf', async () => {
    const engine = createEngine();
    await engine.dispatch({ type: 'project.write', project: { name: 'Basket', color: 'blue' } });
    const projectId = Object.keys(engine.state.projects)[0] ?? '';
    const client = createManageClient({
      engine: engine.core,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'task-1',
    });
    expect(await Effect.runPromise(client.send({ type: 'focus.change', projectId, until: null }))).toEqual({
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
      engine: engine.core,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'task-1',
      projects: (await createTestMachine(engine, createConfigAt(createTempDir(), { userHome: home })))
        .projects,
    });
    const projects = client.projects;
    if (!projects) throw new Error('The client has no project changes.');
    await expect(Effect.runPromise(projects.upsertRepo(projectId, '~/basket'))).rejects.toThrow(
      'is not a git repository.'
    );
    await Effect.runPromise(projects.upsertFolder(projectId, '~/basket'));
    expect(engine.state.projects[projectId]?.folders).toEqual([realpathSync(join(home, 'basket'))]);
    expect(engine.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual(['task-1']);
  });
});

describe('a message to a teammate’s lead', () => {
  function createRelayClient(answer: Response) {
    const stub = createStubEngine((state) => {
      state.tasks = { 'task-1': { id: 'task-1', handle: 'SW-7', title: 'Sign webhooks' } } as never;
    });
    const engine = Effect.runSync(EngineCore.pipe(Effect.provide(createStubEngineCoreLayer(stub))));
    const relayed: { instanceId: string; path: string; body: unknown }[] = [];
    const client = createManageClient({
      engine,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'task-1',
      relay: (instanceId, request) =>
        Effect.promise(async () => {
          relayed.push({ instanceId, path: new URL(request.url).pathname, body: await request.json() });
          return answer;
        }),
    });
    return { client, relayed };
  }

  test('posts the command to the lead’s machine, naming the task its agent works on', async () => {
    const { client, relayed } = createRelayClient(Response.json({ ok: true }));
    await Effect.runPromise(
      client.relay?.('laptop', { type: 'task.message', taskId: 'lead', text: 'Wait for me.' }) ?? Effect.void
    );
    expect(relayed).toEqual([
      {
        instanceId: 'laptop',
        path: '/api/commands',
        body: {
          type: 'task.message',
          taskId: 'lead',
          text: 'Wait for me.',
          fromTeammateTask: { handle: 'SW-7', title: 'Sign webhooks' },
        },
      },
    ]);
  });

  test('passes on the teammate machine’s refusal, or says what it answered', async () => {
    const refused = createRelayClient(
      Response.json({ error: { code: 'handoff_scope', message: 'Not yours.' } }, { status: 403 })
    );
    const send = (client: ReturnType<typeof createRelayClient>['client']) =>
      Effect.runPromise(
        Effect.flip(
          client.relay?.('laptop', { type: 'task.message', taskId: 'lead', text: 'Hi' }) ?? Effect.void
        )
      );
    expect(await send(refused.client)).toMatchObject({ code: 'handoff_scope', message: 'Not yours.' });
    const broken = createRelayClient(new Response('nope', { status: 502 }));
    expect(await send(broken.client)).toMatchObject({
      code: 'relay_failed',
      message: 'The teammate’s machine answered 502.',
    });
  });

  test('names no task when its own task is gone', async () => {
    const stub = createStubEngine();
    const engine = Effect.runSync(EngineCore.pipe(Effect.provide(createStubEngineCoreLayer(stub))));
    const bodies: unknown[] = [];
    const client = createManageClient({
      engine,
      base: 'http://127.0.0.1:1',
      key: null,
      byTask: 'gone',
      relay: (_instanceId, request) =>
        Effect.promise(async () => {
          bodies.push(await request.json());
          return Response.json({ ok: true });
        }),
    });
    await Effect.runPromise(
      client.relay?.('laptop', { type: 'task.message', taskId: 'lead', text: 'Hi' }) ?? Effect.void
    );
    expect(bodies).toEqual([{ type: 'task.message', taskId: 'lead', text: 'Hi' }]);
  });
});
