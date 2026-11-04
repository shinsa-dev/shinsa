import { afterEach, describe, expect, test } from 'bun:test';
import { OWNER_ONLY_MESSAGE, SCOPE_MESSAGES } from '@shinsa/core';
import { Effect } from 'effect';
import { dispatchUserCommand, resolveTeammateRefusal } from '../../../src/http/commands.ts';
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

  test('a command for the machine’s owner is refused to a member and taken from the owner over the channel', async () => {
    const remote = {
      isOwner: (userId: string | null) => Effect.succeed(userId === 'u-owner'),
      tunnelHost: Effect.succeed(null),
      isEnabled: Effect.succeed(true),
    };
    const { send, context } = startRoutes({ remote: remote as never });
    const init = (mergeMethod: string) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'settings.change', patch: { mergeMethod } }),
    });
    const member = await send('/api/commands', init('merge'), {
      via: 'channel',
      guest: null,
      userId: 'u-member',
    });
    expect(member.status).toBe(400);
    expect(await member.json()).toEqual({ error: { code: 'not_owner', message: OWNER_ONLY_MESSAGE } });
    expect(context.engine.state.settings.mergeMethod).not.toBe('merge');
    const owner = await send('/api/commands', init('merge'), {
      via: 'channel',
      guest: null,
      userId: 'u-owner',
    });
    expect(owner.status).toBe(200);
    expect(context.engine.state.settings.mergeMethod).toBe('merge');
    expect((await send('/api/commands', init('rebase'))).status).toBe(200);
    expect(context.engine.state.settings.mergeMethod).toBe('rebase');
  });

  test('a command goes through the router when the engine has one, with the client’s id', async () => {
    const { context } = startRoutes();
    const routed: (string | null)[] = [];
    const router = {
      route: (_command: unknown, from?: { readonly id?: string }) =>
        Effect.sync(() => void routed.push(from?.id ?? null)).pipe(Effect.as([])),
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
          guest: { scope: { kind: 'task', taskId: 'task-1' } } as never,
        })
      )
    );
    expect([refusal.code, refusal.message]).toEqual(['handoff_scope', SCOPE_MESSAGES.command]);
  });
});

describe('handing a task to a teammate', () => {
  const KAI = { id: '7', login: 'kai', name: 'Kai Lane', avatarUrl: null };
  const hand = { type: 'task.hand_to_teammate', taskId: 'task-1', teamId: 'core', teammate: KAI } as const;

  test('is refused before anything happens when the person is not in that team', async () => {
    const teams = {
      resolveTeamScope: (userId: string) => Effect.succeed(userId === '7' ? ({} as never) : null),
    };
    const refuse = (command: Parameters<typeof resolveTeammateRefusal>[0], given: typeof teams | null) =>
      Effect.runPromise(resolveTeammateRefusal(command, given));
    expect(await refuse(hand, teams)).toBeNull();
    expect((await refuse({ ...hand, teammate: { ...KAI, id: '9' } }, teams))?.message).toBe(
      'Kai is not in that team, so they cannot take this task.'
    );
    expect((await refuse(hand, null))?.code).toBe('handoff_refused');
    expect(await refuse({ type: 'task.cancel', taskId: 'task-1' }, null)).toBeNull();
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
