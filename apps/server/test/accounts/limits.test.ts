import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccountUsage, ChatNotice, UsageWindow } from '@shinsa/core';
import {
  createUnknownUsage,
  USAGE_TTL_MS,
  UsageLimits,
  type UsageReader,
} from '../../src/accounts/limits.ts';
import type { UsageRead } from '../../src/accounts/usage.ts';
import { log } from '../../src/log/index.ts';
import { createTempDir } from '../helpers/index.ts';

type RateLimitNotice = Extract<ChatNotice, { kind: 'rate_limit' }>;

const SESSION: UsageWindow = {
  id: 'five_hour',
  kind: 'session',
  label: 'Current session',
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

function createLimits(reads: UsageRead[], options: { path?: string; ttlMs?: number } = {}) {
  const clock = { now: 1_000 };
  const asked: string[] = [];
  const read: UsageReader = (accountId) => {
    asked.push(accountId);
    return Promise.resolve(reads[Math.min(asked.length - 1, reads.length - 1)] as UsageRead);
  };
  const path = options.path ?? join(createTempDir(), 'usage.json');
  const limits = new UsageLimits({ path, read, now: () => clock.now, ttlMs: options.ttlMs });
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
  test('an account never read is unknown', () => {
    expect(createLimits([]).limits.snapshot('a')).toEqual(createUnknownUsage());
    expect(createUnknownUsage()).toEqual({
      status: 'unknown',
      windows: [],
      detail: null,
      checkedAt: null,
      source: null,
    });
  });

  test('a read with windows is ok, stored on disk and announced', async () => {
    const { limits, path } = createLimits([{ ok: true, windows: [SESSION] }]);
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

  test('a read without windows says Claude reports none', async () => {
    const { limits } = createLimits([{ ok: true, windows: [] }]);
    await limits.refresh(['a']);
    expect(limits.snapshot('a')).toMatchObject({
      status: 'unavailable',
      detail: 'Claude reports no usage limits for this account.',
    });
  });

  test('a fresh reading is not read again within the TTL unless forced', async () => {
    const { limits, asked, clock } = createLimits([{ ok: true, windows: [SESSION] }], { ttlMs: 100 });
    await limits.refresh(['a']);
    clock.now += 99;
    expect(limits.isFresh('a')).toBe(true);
    await limits.refresh(['a']);
    expect(asked).toEqual(['a']);
    await limits.refresh(['a'], true);
    expect(asked).toEqual(['a', 'a']);
    clock.now += 100;
    expect(limits.isFresh('a')).toBe(false);
  });

  test('the TTL is a minute by default', async () => {
    const { limits, clock } = createLimits([{ ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    clock.now += USAGE_TTL_MS - 1;
    expect(limits.isFresh('a')).toBe(true);
    clock.now += 1;
    expect(limits.isFresh('a')).toBe(false);
    expect(limits.isFresh('never-read')).toBe(false);
  });

  test('two refreshes of the same account at once share one read', async () => {
    const gate = Promise.withResolvers<UsageRead>();
    let reads = 0;
    const limits = new UsageLimits({
      path: join(createTempDir(), 'usage.json'),
      read: () => {
        reads++;
        return gate.promise;
      },
    });
    const first = limits.refresh(['a']);
    const second = limits.refresh(['a'], true);
    gate.resolve({ ok: true, windows: [SESSION] });
    await Promise.all([first, second]);
    expect(reads).toBe(1);
    expect(limits.snapshot('a').status).toBe('ok');
  });

  test('a failed read never erases what was known, only adds the reason', async () => {
    const { limits } = createLimits([
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
    const { limits } = createLimits([
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
    const limits = new UsageLimits({
      path: join(createTempDir(), 'usage.json'),
      read: () => {
        calls++;
        return Promise.reject(new Error('keychain locked'));
      },
    });
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
      detail: 'Claude asked Shinsa to read usage less often.',
      retryAfterMs: 30_000,
    };
    const { limits, asked, clock } = createLimits([limited, limited, { ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    clock.now += 5 * 60_000 - 1;
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(1);
    clock.now += 1;
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(2);
    expect(limits.snapshot('a').detail).toBe('Claude asked Shinsa to read usage less often.');

    const longer = createLimits([
      { ...limited, retryAfterMs: 10 * 60_000 },
      { ok: true, windows: [] },
    ]);
    await longer.limits.refresh(['b']);
    longer.clock.now += 10 * 60_000 - 1;
    await longer.limits.refresh(['b'], true);
    expect(longer.asked).toHaveLength(1);
    longer.clock.now += 1;
    await longer.limits.refresh(['b'], true);
    expect(longer.asked).toHaveLength(2);

    const unsaid = createLimits([{ ...limited, retryAfterMs: null }]);
    await unsaid.limits.refresh(['c']);
    unsaid.clock.now += 5 * 60_000 - 1;
    await unsaid.limits.refresh(['c'], true);
    expect(unsaid.asked).toHaveLength(1);
  });

  test('the last readings come back from disk, marked as cached', async () => {
    const first = createLimits([{ ok: true, windows: [SESSION] }]);
    await first.limits.refresh(['a']);
    const second = createLimits([], { path: first.path });
    expect(second.limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION],
      detail: null,
      checkedAt: 1_000,
      source: 'cache',
    });
  });

  test('a cache an older version wrote gets the model window ids every reader uses now', () => {
    const path = join(createTempDir(), 'usage.json');
    const keyed = { ...FABLE, id: 'seven_day_opus', label: 'Weekly · Opus', model: 'Opus' };
    const read = { ...keyed, id: 'weekly:opus', usedPercent: 60 };
    writeFileSync(
      path,
      JSON.stringify({ accounts: { a: { ...createUnknownUsage(), windows: [SESSION, keyed, read] } } })
    );
    const { limits } = createLimits([], { path });
    expect(limits.snapshot('a').windows).toEqual([SESSION, { ...keyed, id: 'weekly:opus' }]);
  });

  test('cached entries without windows are dropped and a broken cache is logged and ignored', () => {
    const dir = createTempDir();
    const path = join(dir, 'usage.json');
    writeFileSync(path, JSON.stringify({ accounts: { a: { status: 'ok' }, b: null, c: { windows: [] } } }));
    const { limits } = createLimits([], { path });
    expect(limits.snapshot('a')).toEqual(createUnknownUsage());
    expect(limits.snapshot('b')).toEqual(createUnknownUsage());
    expect(limits.snapshot('c').source).toBe('cache');

    writeFileSync(path, JSON.stringify({}));
    expect(createLimits([], { path }).limits.snapshot('c')).toEqual(createUnknownUsage());

    writeFileSync(path, '{ not json');
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      expect(createLimits([], { path }).limits.snapshot('a')).toEqual(createUnknownUsage());
      expect(warn.mock.calls[0]?.[0]).toBe(
        '[Accounts] The usage cache could not be read; starting without it'
      );
    } finally {
      warn.mockRestore();
    }
  });

  test('a cache that cannot be written is logged and the reading is still kept', async () => {
    const dir = createTempDir();
    writeFileSync(join(dir, 'file'), '');
    const { limits } = createLimits([{ ok: true, windows: [SESSION] }], {
      path: join(dir, 'file', 'usage.json'),
    });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    try {
      await limits.refresh(['a']);
      expect(limits.snapshot('a').status).toBe('ok');
      expect(warn.mock.calls[0]?.[0]).toBe('[Accounts] Could not keep the usage cache');
    } finally {
      warn.mockRestore();
    }
  });

  test('removing an account forgets its usage; an unknown one changes nothing', async () => {
    const { limits, path } = createLimits([{ ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    let changes = 0;
    const unsubscribe = limits.subscribe(() => changes++);
    limits.remove('missing');
    expect(changes).toBe(0);
    limits.remove('a');
    expect(changes).toBe(1);
    expect(limits.snapshot('a')).toEqual(createUnknownUsage());
    expect(JSON.parse(readFileSync(path, 'utf8')).accounts).toEqual({});
    unsubscribe();
    await limits.refresh(['b']);
    expect(changes).toBe(1);
  });
});

describe('pushed rate limits', () => {
  test('a pushed utilization updates the window it names and keeps the read reset time when none is pushed', async () => {
    const { limits } = createLimits([{ ok: true, windows: [SESSION, FABLE] }]);
    await limits.refresh(['a']);
    limits.recordPush('a', createNotice({ limit: 'weekly:fable', utilization: 0.5 }));
    expect(limits.snapshot('a')).toEqual({
      status: 'ok',
      windows: [SESSION, { ...FABLE, usedPercent: 50 }],
      detail: null,
      checkedAt: 1_000,
      source: 'push',
    });
    limits.recordPush('a', createNotice({ limit: 'five_hour', utilization: 2, resetsAt: 12_000 }));
    expect(limits.snapshot('a').windows[0]).toEqual({ ...SESSION, usedPercent: 100, resetsAt: 12_000 });
  });

  test('a push that names a model window by its keyed name updates the window read for that model', async () => {
    const opus: UsageWindow = { ...FABLE, id: 'weekly:opus', label: 'Weekly · Opus', model: 'Opus' };
    const { limits } = createLimits([{ ok: true, windows: [SESSION, opus] }]);
    await limits.refresh(['a']);
    limits.recordPush('a', createNotice({ status: 'rejected', limit: 'seven_day_opus', resetsAt: 60_000 }));
    expect(limits.snapshot('a').windows).toEqual([SESSION, { ...opus, usedPercent: 100, resetsAt: 60_000 }]);
    const fresh = createLimits([]);
    fresh.limits.recordPush('a', createNotice({ limit: 'seven_day_sonnet', utilization: 0.3 }));
    expect(fresh.limits.snapshot('a').windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['weekly:sonnet', 30],
    ]);
  });

  test('a rejection marks the window spent, even before anything was read', () => {
    const { limits } = createLimits([]);
    limits.recordPush('a', createNotice({ status: 'rejected', limit: 'seven_day', resetsAt: 70_000 }));
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
      checkedAt: null,
      source: 'push',
    });
  });

  test('a push without a known window, a limit or a percent is ignored', async () => {
    const { limits } = createLimits([{ ok: true, windows: [SESSION] }]);
    let changes = 0;
    limits.subscribe(() => changes++);
    limits.recordPush('a', createNotice({ limit: null, status: 'rejected' }));
    limits.recordPush('a', createNotice({ limit: 'nimbus_quill', status: 'rejected' }));
    limits.recordPush('a', createNotice({ limit: 'seven_day', utilization: null }));
    expect(changes).toBe(0);
    expect(limits.snapshot('a')).toEqual(createUnknownUsage());
  });

  test('a push without a percent keeps the known percent and refreshes the reset time', async () => {
    const { limits } = createLimits([{ ok: true, windows: [SESSION] }]);
    await limits.refresh(['a']);
    limits.recordPush('a', createNotice({ limit: 'five_hour', utilization: null, resetsAt: 20_000 }));
    expect(limits.snapshot('a').windows).toEqual([{ ...SESSION, resetsAt: 20_000 }]);
    limits.recordPush('a', createNotice({ limit: 'five_hour', utilization: -1 }));
    expect(limits.snapshot('a').windows[0]?.usedPercent).toBe(0);
  });

  test('a push during a 429 back-off keeps the back-off', async () => {
    const limited: UsageRead = { ok: false, reason: 'limited', detail: 'slow down', retryAfterMs: null };
    const { limits, asked } = createLimits([limited, { ok: true, windows: [] }]);
    await limits.refresh(['a']);
    limits.recordPush('a', createNotice({ status: 'rejected' }));
    await limits.refresh(['a'], true);
    expect(asked).toHaveLength(1);
    expect(limits.snapshot('a').windows.map((window) => window.usedPercent)).toEqual([100]);
  });
});
