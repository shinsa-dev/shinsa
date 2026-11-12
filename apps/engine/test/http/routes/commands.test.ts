import { afterEach, describe, expect, test } from 'bun:test';
import { OWNER_ONLY_MESSAGE, SCOPE_MESSAGES, type TaskOwner } from '@shinsa/core';
import { Effect } from 'effect';
import {
  dispatchUserCommand,
  resolveRequestActor,
  resolveTeammateRefusal,
} from '../../../src/http/commands.ts';
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
      resolveActor: () => Effect.succeed(null),
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

describe('who sent a command', () => {
  const MONA = { login: 'mona', name: 'Mona Lisa', avatarUrl: null };
  const KAI = { login: 'kai', name: 'Kai Lane', avatarUrl: 'https://avatars/kai' };
  const people: Record<string, TaskOwner> = { 'u-owner': MONA, 'u-kai': KAI };
  const remote = {
    isOwner: (userId: string | null) => Effect.succeed(userId === 'u-owner'),
    resolveActor: (userId: string | null) => Effect.succeed(people[userId ?? 'u-owner'] ?? null),
    tunnelHost: Effect.succeed(null),
    isEnabled: Effect.succeed(true),
  };

  test('a task created by a member over the channel is theirs, and one made at the machine is its owner’s', async () => {
    const { send, context } = startRoutes({ remote: remote as never });
    const create = (request: string) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...TASK, request }),
    });
    const owners = async (response: Response) => {
      const { taskId } = (await response.json()) as { taskId: string };
      return context.engine.state.tasks[taskId]?.owner ?? null;
    };
    const member = await send('/api/commands', create('From Kai'), {
      via: 'channel',
      guest: null,
      userId: 'u-kai',
    });
    expect(await owners(member)).toEqual(KAI);
    expect(await owners(await send('/api/commands', create('At the keyboard')))).toEqual(MONA);
    const stranger = await send('/api/commands', create('From nobody'), {
      via: 'channel',
      guest: null,
      userId: 'u-gone',
    });
    expect(await owners(stranger)).toBeNull();
  });

  test('a guest is the person they are, and with no remote access or no user nobody is', async () => {
    const actor = (source: Parameters<typeof resolveRequestActor>[0], given: typeof remote | null) =>
      Effect.runPromise(resolveRequestActor(source, given));
    const guest = { id: '7', ...KAI, scope: { kind: 'task', taskId: 't1' } } as const;
    expect(await actor({ via: 'channel', guest, userId: '7' }, null)).toEqual(KAI);
    expect(await actor({ via: 'local', guest: null, userId: null }, null)).toBeNull();
    expect(await actor({ via: 'local', guest: null, userId: null }, remote)).toEqual(MONA);
    expect(await actor({ via: 'tunnel', guest: null, userId: null }, remote)).toBeNull();
    expect(await actor({ via: 'channel', guest: null, userId: 'u-kai' }, remote)).toEqual(KAI);
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

  test('leaves out a provider you removed or never signed in to', async () => {
    const providers = [
      { id: 'claude', label: 'Claude' },
      { id: 'codex', label: 'Codex' },
    ];
    const { send } = startRoutes({
      providers: { listProviders: Effect.succeed(providers) } as never,
      accounts: { listHiddenProviders: Effect.succeed(new Set(['codex'])) } as never,
    });
    expect(await (await send('/api/providers')).json()).toEqual([{ id: 'claude', label: 'Claude' }]);
  });
});
