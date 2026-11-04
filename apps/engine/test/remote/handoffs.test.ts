import { describe, expect, test } from 'bun:test';
import { DomainError, type TaskGuest } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import { JsonLogger } from '../../src/log/service.ts';
import { RemoteUnreachable } from '../../src/remote/client/schema.ts';
import { Handoffs } from '../../src/remote/handoffs/service.ts';
import type { GuestLeaver, HandoffClaim } from '../../src/remote/machine/schema.ts';
import { Remote } from '../../src/remote/machine/service.ts';
import { EngineStopped } from '../../src/runtime/engine/schema.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';
import { captureLogs, until } from '../helpers/index.ts';
import { createStubEngine, createTask } from '../helpers/state.ts';

const KAI: TaskGuest = { id: '7', login: 'kai', name: null, avatarUrl: null };

const REFUSED = new DomainError({ code: 'refused', message: 'Turn on remote access first.' });

type HandoffRemote = Pick<Remote['Service'], 'createHandoff' | 'removeHandoff'>;

function setUp(remote: Partial<HandoffRemote> = {}) {
  const stub = createStubEngine((state) => {
    state.tasks.open = createTask({
      id: 'open',
      handoff: { at: 1, url: null, guest: null, claimedAt: null },
    });
    state.tasks.taken = createTask({ id: 'taken', handoff: { at: 1, url: null, guest: KAI, claimedAt: 5 } });
    state.tasks.plain = createTask({ id: 'plain' });
  });
  const handlers: {
    claim?: (taskId: string, guest: TaskGuest) => Promise<string | null>;
    leave?: (userIds: string[]) => void;
  } = {};
  const fake = {
    handleClaims: (claim: HandoffClaim) =>
      Effect.sync(() => {
        handlers.claim = (taskId, guest) => runPromise(claim(taskId, guest));
      }),
    handleLeaves: (leave: GuestLeaver) =>
      Effect.sync(() => {
        handlers.leave = (userIds) => runSync(leave(userIds));
      }),
    createHandoff: () => Effect.succeed('https://app.shinsa.dev/h#link'),
    removeHandoff: () => Effect.void,
    ...remote,
  };
  const context = Effect.runSync(
    Layer.build(
      Layer.merge(Handoffs.layer, JsonLogger).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(Remote, fake as unknown as Remote['Service']),
            Layer.succeed(EngineCore, stub.engine.core)
          )
        )
      )
    ).pipe(Effect.scoped)
  );
  const service = Context.get(context, Handoffs);
  const runPromise = Effect.runPromiseWith(context);
  const runSync = Effect.runSyncWith(context);
  const handoffs = {
    link: (taskId: string, attempt: { key: string }) =>
      runPromise(service.link(taskId, { attempt: 1, ...attempt })),
    revoke: (taskId: string, guestId: string | null) => runPromise(service.revoke(taskId, guestId)),
  };
  return { ...stub, handoffs, handlers };
}

describe('a hand-off link', () => {
  test('is made once for a task handed off and not yet taken, and recorded under the effect’s key', async () => {
    const { handoffs, dispatched, commandIds } = setUp();
    await handoffs.link('plain', { key: 'k0' });
    await handoffs.link('taken', { key: 'k1' });
    await handoffs.link('open', { key: 'k2' });
    expect(dispatched).toEqual([
      { type: 'handoff.record', taskId: 'open', url: 'https://app.shinsa.dev/h#link' },
    ]);
    expect(commandIds).toEqual(['k2:handoff.record']);
  });

  test('that the machine refuses is a final failure, and one Shinsa Cloud does not answer is tried again', async () => {
    const refused = setUp({ createHandoff: () => Effect.fail(REFUSED) });
    await expect(refused.handoffs.link('open', { key: 'k' } as never)).rejects.toMatchObject({
      _tag: 'EffectFailed',
      message: REFUSED.message,
      retryable: false,
    });
    const down = setUp({
      createHandoff: () =>
        Effect.fail(
          new RemoteUnreachable({ endpoint: 'handoffs', status: 500, message: 'status 500', retryable: true })
        ),
    });
    await expect(down.handoffs.link('open', { key: 'k' } as never)).rejects.toMatchObject({
      message: 'status 500',
      retryable: true,
    });
  });

  test('that cannot be recorded is tried again', async () => {
    const refused = setUp();
    refused.reject((command) => command.type === 'handoff.record', REFUSED);
    await expect(refused.handoffs.link('open', { key: 'k' } as never)).rejects.toMatchObject({
      message: REFUSED.message,
      retryable: true,
    });
    const broken = setUp();
    broken.reject(
      (command) => command.type === 'handoff.record',
      new EngineStopped({ message: 'disk full' })
    );
    await expect(broken.handoffs.link('open', { key: 'k' } as never)).rejects.toMatchObject({
      message: 'disk full',
      retryable: true,
    });
  });

  test('turned off passes Shinsa Cloud’s failure on', async () => {
    const { handoffs } = setUp({
      removeHandoff: () =>
        Effect.fail(
          new RemoteUnreachable({ endpoint: 'handoffs', status: 500, message: 'status 500', retryable: true })
        ),
    });
    await expect(handoffs.revoke('open', null)).rejects.toMatchObject({
      _tag: 'HandoffCallFailed',
      message: 'status 500',
    });
  });
});

describe('a claim', () => {
  test('is recorded as the guest, refused with core’s reason, or answered plainly when it breaks', async () => {
    const logs = captureLogs();
    try {
      const { handlers, dispatched, reject } = setUp();
      expect(await handlers.claim?.('open', { ...KAI, extra: true } as TaskGuest)).toBeNull();
      expect(dispatched.at(-1)).toEqual({ type: 'handoff.claim', taskId: 'open', guest: KAI });
      reject((command) => command.type === 'handoff.claim' && command.taskId === 'taken', REFUSED);
      expect(await handlers.claim?.('taken', KAI)).toBe(REFUSED.message);
      reject((command) => command.type === 'handoff.claim', new EngineStopped({ message: 'disk full' }));
      expect(await handlers.claim?.('open', KAI)).toContain('could not hand the task to you');
      expect(logs.fieldsOf('[Handoff] Could not record a claim')).toEqual([
        { taskId: 'open', error: 'disk full' },
      ]);
    } finally {
      logs.restore();
    }
  });

  test('is given back when its guest leaves, and a failure to do so is logged', async () => {
    const logs = captureLogs();
    try {
      const { handlers, dispatched, commandIds, reject } = setUp();
      handlers.leave?.(['someone-else']);
      expect(dispatched).toEqual([]);
      handlers.leave?.([KAI.id]);
      await until('given back', () => dispatched.length === 1);
      expect(dispatched).toEqual([{ type: 'handoff.leave', taskId: 'taken', guestId: KAI.id }]);
      expect(commandIds).toEqual([`handoff.leave:taken:${KAI.id}:5`]);
      reject((command) => command.type === 'handoff.leave', new EngineStopped({ message: 'disk full' }));
      handlers.leave?.([KAI.id]);
      await until('logged', () => logs.fieldsOf('[Handoff] Could not give a task back').length > 0);
      expect(logs.fieldsOf('[Handoff] Could not give a task back')).toEqual([
        { taskId: 'taken', error: 'disk full' },
      ]);
    } finally {
      logs.restore();
    }
  });
});
