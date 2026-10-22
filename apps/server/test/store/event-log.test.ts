import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ShinsaEffect } from '@shinsa/core';
import { EventLog, SETTLED_RETENTION_MS } from '../../src/store/index.ts';
import { createTempDir } from '../helpers/index.ts';

function openLog() {
  const path = join(createTempDir(), 'shinsa.sqlite');
  return { path, log: new EventLog(path) };
}

const briefing: ShinsaEffect = { kind: 'briefing.request', areaId: null };

describe('EventLog', () => {
  test('events are numbered from the given sequence and read back in order', () => {
    const { log } = openLog();
    const events = log.commit(
      [
        { type: 'area.removed', areaId: 'a' },
        { type: 'area.removed', areaId: 'b' },
      ],
      [],
      4,
      1000
    );
    expect(events.map((event) => event.seq)).toEqual([5, 6]);
    expect(log.listEvents()).toEqual([
      { type: 'area.removed', areaId: 'a', seq: 5, at: 1000 },
      { type: 'area.removed', areaId: 'b', seq: 6, at: 1000 },
    ]);
    log.close();
  });

  test('effects committed without events are never mistaken for earlier ones', () => {
    const { log } = openLog();
    log.commit([], [briefing], 0, 1);
    log.commit([], [briefing], 0, 2);
    log.commit([{ type: 'area.removed', areaId: 'a' }], [briefing], 0, 3);
    log.commit([], [briefing, briefing], 1, 4);
    expect(log.listEffectStatuses()).toHaveLength(5);
    log.close();
  });

  test('a keyed effect is stored once, however often it is committed', () => {
    const { log } = openLog();
    const execute: ShinsaEffect = { kind: 'run.execute', runId: 'r1' };
    log.commit([{ type: 'area.removed', areaId: 'a' }], [execute], 0, 1);
    log.commit([{ type: 'area.removed', areaId: 'b' }], [execute], 1, 2);
    expect(log.listEffectStatuses()).toEqual([{ kind: 'run.execute', status: 'pending', attempts: 0 }]);
    log.close();
  });

  test('a lane runs one effect at a time, in order, and other lanes run alongside', () => {
    const { log } = openLog();
    log.commit(
      [{ type: 'area.removed', areaId: 'a' }],
      [
        { kind: 'checks.run', taskId: 't1', round: 1 },
        { kind: 'pull_request.open', taskId: 't1' },
        { kind: 'checks.run', taskId: 't2', round: 1 },
      ],
      0,
      1
    );
    const first = log.claimEffects(10);
    expect(first.map((stored) => [stored.lane, stored.effect.kind, stored.attempts])).toEqual([
      ['task:t1', 'checks.run', 1],
      ['task:t2', 'checks.run', 1],
    ]);
    expect(log.claimEffects(10)).toEqual([]);
    log.settleEffect(first[0]?.id ?? 0, 11);
    expect(log.claimEffects(12).map((stored) => stored.effect.kind)).toEqual(['pull_request.open']);
    log.close();
  });

  test('a retried effect waits for its time and counts its attempts; a failed one stays failed', () => {
    const { log } = openLog();
    log.commit(
      [{ type: 'area.removed', areaId: 'a' }],
      [briefing, { kind: 'worktree.remove', taskId: 't' }],
      0,
      1
    );
    const [first, second] = log.claimEffects(1);
    log.retryEffect(first?.id ?? 0, 500, 'busy');
    log.failEffect(second?.id ?? 0, 2, 'gone');
    expect(log.selectNextAvailableAt()).toBe(500);
    expect(log.claimEffects(100)).toEqual([]);
    expect(log.claimEffects(500).map((stored) => stored.attempts)).toEqual([2]);
    expect(log.selectNextAvailableAt()).toBeNull();
    expect(log.listEffectStatuses().map((row) => row.status)).toEqual(['running', 'failed']);
    log.close();
  });

  test('after a restart, process-bound work is cancelled, interrupted work runs again and old rows go', () => {
    const { path, log } = openLog();
    log.commit(
      [{ type: 'area.removed', areaId: 'a' }],
      [
        { kind: 'run.execute', runId: 'r1' },
        { kind: 'checks.run', taskId: 't1', round: 1 },
        { kind: 'worktree.remove', taskId: 't2' },
      ],
      0,
      1
    );
    const claimed = log.claimEffects(1);
    log.settleEffect(claimed[2]?.id ?? 0, 1);
    log.reconcileAfterRestart(1 + SETTLED_RETENTION_MS + 1);
    expect(log.listEffectStatuses()).toEqual([
      { kind: 'run.execute', status: 'cancelled', attempts: 1 },
      { kind: 'checks.run', status: 'pending', attempts: 1 },
    ]);
    log.close();
    const raw = new Database(path);
    expect(raw.query('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
    raw.close();
  });
});
