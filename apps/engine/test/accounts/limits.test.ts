import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AccountUsage, ChatNotice, ExtraUsage, UsageResetGrant, UsageWindow } from '@shinsa/core';
import { Duration, Effect, Exit, Layer, Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { AccountChanges } from '../../src/accounts/changes/service.ts';
import { UsageLimits } from '../../src/accounts/limits/service.ts';
import { createUnknownUsage } from '../../src/accounts/limits/unknown.ts';
import { UsageReadings } from '../../src/accounts/readings/service.ts';
import { AccountRegistry } from '../../src/accounts/registry/service.ts';
import { AccountStepFailed, USAGE_TTL, type UsageRead, UsageTtl } from '../../src/accounts/schema.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { JsonLogger } from '../../src/log/service.ts';
import { JsonFileLayer } from '../helpers/files.ts';
import { captureLogs, createTempDir, createTestConfig } from '../helpers/index.ts';

const USAGE_TTL_MS = Duration.toMillis(USAGE_TTL);

type UsageReader = (accountId: string) => Promise<UsageRead>;

const scopes: Scope.Closeable[] = [];

afterEach(async () => {
  for (const scope of scopes.splice(0)) await Effect.runPromise(Scope.close(scope, Exit.void));
});

async function openLimits(read: UsageReader, path: string, ttlMs?: number) {
  const readings = UsageReadings.of({
    providerIds: [],
    readAccount: (accountId) =>
      Effect.tryPromise({
        try: () => read(accountId),
        catch: (error) =>
          new AccountStepFailed({ message: error instanceof Error ? error.message : String(error) }),
      }),
    readProvider: () => Effect.die('not used'),
    selectProviderIdentity: () => Effect.succeed(null),
  });
  const layer = UsageLimits.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(UsageReadings, readings),
        AccountRegistry.layer.pipe(Layer.provide(JsonFileLayer)),
        AccountChanges.layer,
        Layer.succeed(EngineConfig, { ...createTestConfig(createTempDir()), dataDir: dirname(path) }),
        ...(ttlMs === undefined ? [] : [Layer.succeed(UsageTtl, Duration.millis(ttlMs))])
      )
    ),
    Layer.provideMerge(JsonLogger),
    Layer.provideMerge(TestClock.layer())
  );
  const scope = Effect.runSync(Scope.make());
  scopes.push(scope);
  const context = await Effect.runPromise(Layer.buildWithScope(layer, scope));
  const sync = Effect.runSyncWith(context);
  const run = Effect.runPromiseWith(context);
  const usage = sync(UsageLimits.use(Effect.succeed)).claude;
  const changes = sync(AccountChanges.use(Effect.succeed));
  const clock = {
    now: 1_000,
    advance: async (ms: number) => {
      clock.now += ms;
      await run(TestClock.setTime(clock.now));
    },
  };
  await run(TestClock.setTime(clock.now));
  const limits = {
    snapshot: (id: string) => sync(usage.snapshot(id)),
    measured: (id: string) => sync(usage.measured(id)),
    isFresh: (id: string) => sync(usage.isFresh(id)),
    refresh: (ids: string[], force = false) => run(usage.refresh(ids, force)),
    remove: (id: string) => run(usage.remove(id)),
    recordPush: (id: string, notice: RateLimitNotice) => run(usage.recordPush(id, notice)),
    subscribe: (listener: () => void) => {
      const listening = sync(Scope.make());
      sync(changes.listen(Effect.sync(listener)).pipe(Scope.provide(listening)));
      return () => sync(Scope.close(listening, Exit.void));
    },
  };
  return { limits, clock };
}

type RateLimitNotice = Extract<ChatNotice, { kind: 'rate_limit' }>;

const SESSION: UsageWindow = {
  id: 'five_hour',
  kind: 'session',
  label: '5-hour limit',
  model: null,
  usedPercent: 40,
  resetsAt: 9_000,
};

const FABLE: UsageWindow = {
  id: 'weekly:fable',
  kind: 'model',
  label: 'Weekly · Fable',
  model: 'Fable',
  usedPercent: 10,
  resetsAt: 50_000,
};

const EXTRA_ON: ExtraUsage = {
  enabled: true,
  noLimit: false,
  credit: { minor: 1240, exponent: 2, currency: 'USD' },
};

const GRANT: UsageResetGrant = {
  id: 'opus55-launch',
  label: 'Opus 5.5 launch reset',
  left: 1,
  total: 1,
  clears: ['five_hour', 'seven_day'],
  usableNow: true,
  endsAt: 90_000,
  givesBackWeekly: false,
  weeklyShare: null,
};

async function createLimits(reads: UsageRead[], options: { path?: string; ttlMs?: number } = {}) {
  const asked: string[] = [];
  const read: UsageReader = (accountId) => {
    asked.push(accountId);
    return Promise.resolve(reads[Math.min(asked.length - 1, reads.length - 1)] as UsageRead);
  };
  const path = options.path ?? join(createTempDir(), 'usage-limits.json');
  const { limits, clock } = await openLimits(read, path, options.ttlMs);
  return { limits, asked, clock, path };
}

function createNotice(patch: Partial<RateLimitNotice>): RateLimitNotice {
  return {
    kind: 'rate_limit',
    status: 'allowed',
    limit: 'five_hour',
    resetsAt: null,
    utilization: null,
    ...patch,
  };
}

describe('usage limits', () => {
  test('an account never read is unknown', async () => {
    expect((await createLimits([])).limits.snapshot('a')).toEqual(createUnknownUsage());
    expect(createUnknownUsage()).toEqual({
      status: 'unknown',
      windows: [],
      detail: null,
      checkedAt: null,
      source: null,
    });
  });

  test('a read with windows is ok, stored on disk and announced', async () => {
    const { limits, path } = await createLimits([{ ok: true, windows: [SESSION] }]);
    let changes = 0;
    limits.subscribe(() => changes++);
    await limits.refresh(['a']);
    const usage: AccountUsage = {
      status: 'ok',
      windows: [SESSION],
      detail: null,
      checkedAt: 1_000,
      source: 'read',
    };
    expect(limits.snapshot('a')).toEqual(usage);
    expect(changes).toBe(1);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ version: 1, accounts: { a: usage } });
  });

  test('a read keeps the extra usage and reset grants Claude reports, on disk too', async () => {
    const { limits, path } = await createLimits([
      { ok: true, windows: [SESSION], extraUsage: EXTRA_ON, resetGrants: [GRANT] },
    ]);
    await limits.refresh(['a']);
    expect(limits.snapshot('a')).toMatchObject({ extraUsage: EXTRA_ON, resetGrants: [GRANT] });
    expect(JSON.parse(readFileSync(path, 'utf8')).accounts.a).toMatchObject({
      extraUsage: EXTRA_ON,
      resetGrants: [GRANT],
    });
  });

  test('a failed read keeps the last extra usage and reset grants', async () => {
    const { limits } = await createLimits([
      { ok: true, windows: [SESSION], extraUsage: EXTRA_ON, resetGrants: [GRANT] },
      { ok: false, reason: 'failed', detail: 'Claude answered 503.', retryAfterMs: null },
    ]);
    await limits.refresh(['a']);
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a')).toMatchObject({
      detail: 'Claude answered 503.',
      extraUsage: EXTRA_ON,
      resetGrants: [GRANT],
    });
  });

  test('a read that reports no grants and no extra usage clears them; one that says nothing keeps them', async () => {
    const { limits } = await createLimits([
      { ok: true, windows: [SESSION], extraUsage: EXTRA_ON, resetGrants: [GRANT] },
      { ok: true, windows: [SESSION] },
      { ok: true, windows: [SESSION], extraUsage: null, resetGrants: [] },
    ]);
    await limits.refresh(['a']);
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a')).toMatchObject({ extraUsage: EXTRA_ON, resetGrants: [GRANT] });
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a')).not.toHaveProperty('extraUsage');
    expect(limits.snapshot('a')).not.toHaveProperty('resetGrants');
  });

  test('extra usage and reset grants come back from the cache', async () => {
    const first = await createLimits([
      { ok: true, windows: [SESSION], extraUsage: EXTRA_ON, resetGrants: [GRANT] },
    ]);
    await first.limits.refresh(['a']);
    const second = await createLimits([], { path: first.path });
    expect(second.limits.snapshot('a')).toMatchObject({
      source: 'cache',
      extraUsage: EXTRA_ON,
      resetGrants: [GRANT],
    });
  });

  test('a read without windows says Claude reports none', async () => {
    const { limits } = await createLimits([{ ok: true, windows: [] }]);
    await limits.refresh(['a']);
    expect(limits.snapshot('a')).toMatchObject({
      status: 'unavailable',
      detail: 'Claude reports no usage limits for this account.',
    });
  });

  test('a fresh reading is not read again within the TTL unless forced', async () => {
    const { limits, asked, clock } = await createLimits([{ ok: true, windows: [SESSION] }], { ttlMs: 100 });
    await limits.refresh(['a']);
    await clock.advance(99);
    expect(limits.isFresh('a')).toBe(true);
    await limits.refresh(['a']);
    expect(asked).toEqual(['a']);
    await limits.refresh(['a'], true);
    expect(asked).toEqual(['a', 'a']);
    await clock.advance(100);
    expect(limits.isFresh('a')).toBe(false);
  });

  test('the TTL is a minute by default', async () => {
    const { limits, clock } = await createLimits([{ ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    await clock.advance(USAGE_TTL_MS - 1);
    expect(limits.isFresh('a')).toBe(true);
    await clock.advance(1);
    expect(limits.isFresh('a')).toBe(false);
    expect(limits.isFresh('never-read')).toBe(false);
  });

  test('two refreshes of the same account at once share one read', async () => {
    const gate = Promise.withResolvers<UsageRead>();
    let reads = 0;
    const { limits } = await openLimits(
      () => {
        reads++;
        return gate.promise;
      },
      join(createTempDir(), 'usage-limits.json')
    );
    const first = limits.refresh(['a']);
    const second = limits.refresh(['a'], true);
    gate.resolve({ ok: true, windows: [SESSION] });
    await Promise.all([first, second]);
    expect(reads).toBe(1);
    expect(limits.snapshot('a').status).toBe('ok');
  });

  test('a failed read never erases what was known, only adds the reason', async () => {
    const { limits } = await createLimits([
      { ok: true, windows: [SESSION] },
      { ok: false, reason: 'failed', detail: 'Claude answered 503.', retryAfterMs: null },
    ]);
    await limits.refresh(['a']);
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION],
      detail: 'Claude answered 503.',
      checkedAt: 1_000,
      source: 'read',
    });
  });

  test('a failed first read is unavailable with the reason', async () => {
    const { limits } = await createLimits([
      {
        ok: false,
        reason: 'expired',
        detail: 'The login needs refreshing. It refreshes the next time an agent runs on this account.',
        retryAfterMs: null,
      },
    ]);
    await limits.refresh(['a']);
    expect(limits.snapshot('a')).toEqual({
      status: 'unavailable',
      windows: [],
      detail: 'The login needs refreshing. It refreshes the next time an agent runs on this account.',
      checkedAt: null,
      source: null,
    });
  });

  test('a reader that throws is a failed read with the reason, and the next refresh tries again', async () => {
    let calls = 0;
    const { limits } = await openLimits(
      () => {
        calls++;
        return Promise.reject(new Error('keychain locked'));
      },
      join(createTempDir(), 'usage-limits.json')
    );
    await limits.refresh(['a']);
    expect(limits.snapshot('a')).toMatchObject({
      status: 'unavailable',
      detail: 'Could not read usage: keychain locked',
    });
    await limits.refresh(['a']);
    expect(calls).toBe(2);
  });

  test('a 429 backs off for at least five minutes, or longer when Claude asks, even when forced', async () => {
    const limited: UsageRead = {
      ok: false,
      reason: 'limited',
      detail: 'Rate limited by Claude.',
      retryAfterMs: 30_000,
    };
    const { limits, asked, clock } = await createLimits([limited, limited, { ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    await clock.advance(5 * 60_000 - 1);
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(1);
    await clock.advance(1);
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(2);
    expect(limits.snapshot('a').detail).toBe('Rate limited by Claude.');

    const longer = await createLimits([
      { ...limited, retryAfterMs: 10 * 60_000 },
      { ok: true, windows: [] },
    ]);
    await longer.limits.refresh(['b']);
    await longer.clock.advance(10 * 60_000 - 1);
    await longer.limits.refresh(['b'], true);
    expect(longer.asked).toHaveLength(1);
    await longer.clock.advance(1);
    await longer.limits.refresh(['b'], true);
    expect(longer.asked).toHaveLength(2);

    const unsaid = await createLimits([{ ...limited, retryAfterMs: null }]);
    await unsaid.limits.refresh(['c']);
    await unsaid.clock.advance(5 * 60_000 - 1);
    await unsaid.limits.refresh(['c'], true);
    expect(unsaid.asked).toHaveLength(1);
  });

  test('a 429 keeps when the next read may happen on the reading, and a read that works clears it', async () => {
    const limited: UsageRead = {
      ok: false,
      reason: 'limited',
      detail: 'slow down',
      retryAfterMs: 53 * 60_000,
    };
    const { limits, clock } = await createLimits([
      { ok: true, windows: [SESSION] },
      limited,
      { ok: true, windows: [SESSION] },
    ]);
    await limits.refresh(['a']);
    await clock.advance(2 * 60 * 60_000);
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION],
      detail: 'slow down',
      checkedAt: 1_000,
      source: 'read',
      retryAt: clock.now + 53 * 60_000,
    });
    await clock.advance(53 * 60_000);
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION],
      detail: null,
      checkedAt: clock.now,
      source: 'read',
    });
  });

  test('another failure after a 429 drops the old back-off', async () => {
    const { limits, asked, clock } = await createLimits([
      { ok: false, reason: 'limited', detail: 'slow down', retryAfterMs: null },
      { ok: false, reason: 'failed', detail: 'Claude answered 503.', retryAfterMs: null },
      { ok: true, windows: [SESSION] },
    ]);
    await limits.refresh(['a']);
    await clock.advance(5 * 60_000);
    await limits.refresh(['a'], true);
    expect(limits.snapshot('a').retryAt).toBeUndefined();
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(3);
  });

  test('a back-off survives a restart', async () => {
    const limited: UsageRead = { ok: false, reason: 'limited', detail: 'slow down', retryAfterMs: null };
    const first = await createLimits([{ ok: true, windows: [SESSION] }, limited]);
    await first.limits.refresh(['a']);
    await first.limits.refresh(['a'], true);
    const second = await createLimits([{ ok: true, windows: [SESSION] }], { path: first.path });
    expect(second.limits.snapshot('a').retryAt).toBe(1_000 + 5 * 60_000);
    await second.limits.refresh(['a'], true);
    expect(second.asked).toHaveLength(0);
    await second.clock.advance(5 * 60_000);
    await second.limits.refresh(['a'], true);
    expect(second.asked).toHaveLength(1);
  });

  test('the last readings come back from disk, marked as cached', async () => {
    const first = await createLimits([{ ok: true, windows: [SESSION] }]);
    await first.limits.refresh(['a']);
    const second = await createLimits([], { path: first.path });
    expect(second.limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION],
      detail: null,
      checkedAt: 1_000,
      source: 'cache',
    });
  });

  test('the last measured reading survives a restart even when a push came after it', async () => {
    const first = await createLimits([{ ok: true, windows: [SESSION] }]);
    await first.limits.refresh(['a']);
    await first.limits.recordPush(
      'a',
      createNotice({ status: 'rejected', limit: 'seven_day', resetsAt: 70_000 })
    );
    const second = await createLimits([], { path: first.path });
    expect(second.limits.snapshot('a').windows.map((window) => window.id)).toEqual([
      'five_hour',
      'seven_day',
    ]);
    expect(second.limits.measured('a')).toMatchObject({ windows: [SESSION], checkedAt: 1_000 });
    await second.limits.remove('a');
    const third = await createLimits([], { path: first.path });
    expect(third.limits.measured('a')).toEqual(createUnknownUsage());
  });

  test('cached entries without windows are dropped and a broken cache is logged and ignored', async () => {
    const dir = createTempDir();
    const path = join(dir, 'usage-limits.json');
    writeFileSync(path, JSON.stringify({ accounts: { a: { status: 'ok' }, b: null, c: { windows: [] } } }));
    const { limits } = await createLimits([], { path });
    expect(limits.snapshot('a')).toEqual(createUnknownUsage());
    expect(limits.snapshot('b')).toEqual(createUnknownUsage());
    expect(limits.snapshot('c').source).toBe('cache');

    writeFileSync(path, JSON.stringify({}));
    expect((await createLimits([], { path })).limits.snapshot('c')).toEqual(createUnknownUsage());

    writeFileSync(path, '{ not json');
    const logs = captureLogs();
    try {
      expect((await createLimits([], { path })).limits.snapshot('a')).toEqual(createUnknownUsage());
    } finally {
      logs.restore();
    }
    expect(logs.entries[0]?.message).toBe(
      '[Accounts] The usage cache could not be read; starting without it'
    );
  });

  test('a cache that cannot be written is logged and the reading is still kept', async () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'file'), '');
    const { limits } = await createLimits([{ ok: true, windows: [SESSION] }], {
      path: join(dir, 'file', 'usage-limits.json'),
    });
    const logs = captureLogs();
    try {
      await limits.refresh(['a']);
      expect(limits.snapshot('a').status).toBe('ok');
    } finally {
      logs.restore();
    }
    expect(logs.entries[0]?.message).toBe('[Accounts] Could not keep the usage cache');
  });

  test('removing an account forgets its usage; an unknown one changes nothing', async () => {
    const { limits, path } = await createLimits([{ ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    let changes = 0;
    const unsubscribe = limits.subscribe(() => changes++);
    await limits.remove('missing');
    expect(changes).toBe(0);
    await limits.remove('a');
    expect(changes).toBe(1);
    expect(limits.snapshot('a')).toEqual(createUnknownUsage());
    expect(JSON.parse(readFileSync(path, 'utf8')).accounts).toEqual({});
    unsubscribe();
    await limits.refresh(['b']);
    expect(changes).toBe(1);
  });
});

describe('pushed rate limits', () => {
  test('a pushed utilization updates the window it names, moves the time it was checked and keeps the read reset time when none is pushed', async () => {
    const { limits, clock } = await createLimits([{ ok: true, windows: [SESSION, FABLE] }]);
    await limits.refresh(['a']);
    await clock.advance(2 * 60 * 60_000);
    await limits.recordPush('a', createNotice({ limit: 'weekly:fable', utilization: 0.5 }));
    expect(limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION, { ...FABLE, usedPercent: 50 }],
      detail: null,
      checkedAt: clock.now,
      source: 'push',
    });
    await limits.recordPush('a', createNotice({ limit: 'five_hour', utilization: 2, resetsAt: 12_000 }));
    expect(limits.snapshot('a').windows[0]).toEqual({ ...SESSION, usedPercent: 100, resetsAt: 12_000 });
  });

  test('a push that names a model window by its keyed name updates the window read for that model', async () => {
    const opus: UsageWindow = { ...FABLE, id: 'weekly:opus', label: 'Weekly · Opus', model: 'Opus' };
    const { limits } = await createLimits([{ ok: true, windows: [SESSION, opus] }]);
    await limits.refresh(['a']);
    await limits.recordPush(
      'a',
      createNotice({ status: 'rejected', limit: 'seven_day_opus', resetsAt: 60_000 })
    );
    expect(limits.snapshot('a').windows).toEqual([SESSION, { ...opus, usedPercent: 100, resetsAt: 60_000 }]);
    const fresh = await createLimits([]);
    await fresh.limits.recordPush('a', createNotice({ limit: 'seven_day_sonnet', utilization: 0.3 }));
    expect(fresh.limits.snapshot('a').windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['weekly:sonnet', 30],
    ]);
  });

  test('a rejection marks the window spent, even before anything was read', async () => {
    const { limits } = await createLimits([]);
    await limits.recordPush('a', createNotice({ status: 'rejected', limit: 'seven_day', resetsAt: 70_000 }));
    expect(limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [
        {
          id: 'seven_day',
          kind: 'weekly',
          label: 'Weekly · All models',
          model: null,
          usedPercent: 100,
          resetsAt: 70_000,
        },
      ],
      detail: null,
      checkedAt: 1_000,
      source: 'push',
    });
  });

  test('a push without a known window, a limit or a percent is ignored', async () => {
    const { limits } = await createLimits([{ ok: true, windows: [SESSION] }]);
    let changes = 0;
    limits.subscribe(() => changes++);
    await limits.recordPush('a', createNotice({ limit: null, status: 'rejected' }));
    await limits.recordPush('a', createNotice({ limit: 'nimbus_quill', status: 'rejected' }));
    await limits.recordPush('a', createNotice({ limit: 'seven_day', utilization: null }));
    expect(changes).toBe(0);
    expect(limits.snapshot('a')).toEqual(createUnknownUsage());
  });

  test('a push without a percent keeps the known percent and refreshes the reset time', async () => {
    const { limits } = await createLimits([{ ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    await limits.recordPush('a', createNotice({ limit: 'five_hour', utilization: null, resetsAt: 20_000 }));
    expect(limits.snapshot('a').windows).toEqual([{ ...SESSION, resetsAt: 20_000 }]);
    await limits.recordPush('a', createNotice({ limit: 'five_hour', utilization: -1 }));
    expect(limits.snapshot('a').windows[0]?.usedPercent).toBe(0);
  });

  test('a push during a 429 back-off keeps the back-off', async () => {
    const limited: UsageRead = { ok: false, reason: 'limited', detail: 'slow down', retryAfterMs: null };
    const { limits, asked } = await createLimits([limited, { ok: true, windows: [] }]);
    await limits.refresh(['a']);
    await limits.recordPush('a', createNotice({ status: 'rejected' }));
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(1);
    expect(limits.snapshot('a').windows.map((window) => window.usedPercent)).toEqual([100]);
    expect(limits.snapshot('a').retryAt).toBe(1_000 + 5 * 60_000);
  });
});
