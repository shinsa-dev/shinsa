import { afterEach, describe, expect, test } from 'bun:test';
import { LOCAL_ONLY_MESSAGE, SCOPE_MESSAGES } from '@shinsa/core';
import { Effect } from 'effect';
import { dispatchUserCommand } from '../../../src/http/commands.ts';
import { Engine } from '../../helpers/engine.ts';
import { openEventLog } from '../../helpers/event-log.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

const TASK = { type: 'task.create', request: 'Add search', repoId: null };

describe('POST /api/commands', () => {
  test('an engine opened read-only refuses every command', async () => {
    const { post } = startRoutes(({ config }) => ({
      engine: new Engine(openEventLog(config.databasePath), { readOnly: true }),
    }));
    const response = await post('/api/commands', TASK);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: 'inspect_read_only', message: 'Inspect mode is read-only.' },
    });
  });

  test('a command that only the machine itself may send is refused over the remote channel', async () => {
    const { send, context } = startRoutes();
    const change = { type: 'settings.change', patch: { mergeMethod: 'merge' } };
    const init = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(change),
    };
    const remote = await send('/api/commands', init, { via: 'channel', guest: null, userId: null });
    expect(remote.status).toBe(400);
    expect(await remote.json()).toEqual({ error: { code: 'local_only', message: LOCAL_ONLY_MESSAGE } });
    expect((await send('/api/commands', init)).status).toBe(200);
    expect(context.engine.state.settings.mergeMethod).toBe('merge');
  });

  test('a command goes through the router when the engine has one, with the client’s id', async () => {
    const { context } = startRoutes();
    const routed: (string | null)[] = [];
    const router = {
      route: (_command: unknown, id: string | null) =>
        Effect.sync(() => void routed.push(id)).pipe(Effect.as([])),
    };
    const taskId = await Effect.runPromise(
      dispatchUserCommand(context.engine.core, TASK, { clientId: 'c1', router, origin: 'local', guest: null })
    );
    expect([taskId, routed]).toEqual([null, ['client:c1']]);
  });

  test('a guest is held to the task it was handed', async () => {
    const { context } = startRoutes();
    const refusal = await Effect.runPromise(
      Effect.flip(
        dispatchUserCommand(context.engine.core, TASK, {
          clientId: null,
          router: null,
          origin: 'remote',
          guest: { taskId: 'task-1' } as never,
        })
      )
    );
    expect([refusal.code, refusal.message]).toEqual(['handoff_scope', SCOPE_MESSAGES.command]);
  });
});

describe('GET /api/providers', () => {
  test('answers the providers the engine was given', async () => {
    const providers = [{ id: 'codex', label: 'Codex' }];
    const { send } = startRoutes({
      providers: { listProviders: Effect.succeed(providers) } as never,
    });
    expect(await (await send('/api/providers')).json()).toEqual(providers);
  });
});
