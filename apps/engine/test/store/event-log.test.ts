import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ShinsaEffect } from '@shinsa/core';
import { SETTLED_RETENTION_MS } from '../../src/store/event-log.ts';
import { EventLog } from '../../src/store/index.ts';
import { commitEvents, createTempDir } from '../helpers/index.ts';

function openLog() {
  const path = join(createTempDir(), 'shinsa.sqlite');
  return { path, log: new EventLog(path) };
}

const briefing: ShinsaEffect = { kind: 'briefing.request', projectId: null };

function statuses(log: EventLog) {
  return log.listEffectStatuses().map(({ kind, status, attempts }) => ({ kind, status, attempts }));
}

const receipt = (id: string) => ({ id, type: 'project.remove', target: 'projectId:a', fingerprint: 'f' });

describe('EventLog', () => {
  test('events are numbered from the given sequence and read back in order', () => {
    const { log } = openLog();
    const events = commitEvents(
      log,
      [
        { type: 'project.removed', projectId: 'a' },
        { type: 'project.removed', projectId: 'b' },
      ],
      [],
      4,
      1000
    );
    expect(events.map((event) => event.seq)).toEqual([5, 6]);
    expect(log.readEvents()).toEqual({
      events: [
        { type: 'project.removed', projectId: 'a', seq: 5, at: 1000 },
        { type: 'project.removed', projectId: 'b', seq: 6, at: 1000 },
      ],
      unreadable: [],
      lastSeq: 6,
    });
    expect(log.listEventsBetween(6, 6)).toEqual([
      { type: 'project.removed', projectId: 'b', seq: 6, at: 1000 },
    ]);
    expect(log.listEventsBetween(7, 6)).toEqual([]);
    log.close();
  });

  test('a corrupt or half-written event is reported, and every event after it is still read', () => {
    const { path, log } = openLog();
    commitEvents(
      log,
      [
        { type: 'project.removed', projectId: 'a' },
        { type: 'project.removed', projectId: 'b' },
        { type: 'project.removed', projectId: 'c' },
        { type: 'project.removed', projectId: 'd' },
      ],
      [],
      0,
      1
    );
    const db = new Database(path);
    db.run(`UPDATE events SET payload = '{"type":"project.rem' WHERE seq = 2`);
    db.run(`UPDATE events SET payload = '{"type":"focus.changed"}' WHERE seq = 3`);
    db.close();
    const read = log.readEvents();
    expect(read.events.map((event) => event.seq)).toEqual([1, 4]);
    expect(read.lastSeq).toBe(4);
    expect(read.unreadable.map((problem) => [problem.seq, problem.type])).toEqual([
      [2, 'project.removed'],
      [3, 'project.removed'],
    ]);
    expect(read.unreadable[0]?.error).toStartWith('The stored event is not valid JSON');
    expect(read.unreadable[1]?.error).toBe('The stored event does not match its type.');
    expect(new EventLog(join(createTempDir(), 'empty.sqlite')).readEvents().lastSeq).toBe(0);
    log.close();
  });

  test('effects committed without events are never mistaken for earlier ones', () => {
    const { log } = openLog();
    commitEvents(log, [], [briefing], 0, 1);
    commitEvents(log, [], [briefing], 0, 2);
    commitEvents(log, [{ type: 'project.removed', projectId: 'a' }], [briefing], 0, 3);
    commitEvents(log, [], [briefing, briefing], 1, 4);
    expect(log.listEffectStatuses()).toHaveLength(5);
    log.close();
  });

  test('a keyed effect is stored once, however often it is committed', () => {
    const { log } = openLog();
    const execute: ShinsaEffect = { kind: 'run.execute', runId: 'r1' };
    commitEvents(log, [{ type: 'project.removed', projectId: 'a' }], [execute], 0, 1);
    commitEvents(log, [{ type: 'project.removed', projectId: 'b' }], [execute], 1, 2);
    expect(log.listEffectStatuses()).toEqual([
      { key: 'run.execute:r1', kind: 'run.execute', status: 'pending', attempts: 0 },
    ]);
    expect(log.selectEffectStatus('run.execute:r1')).toBe('pending');
    expect(log.selectEffectStatus('run.execute:r2')).toBeNull();
    log.close();
  });

  test('a lane runs one effect at a time, in order, and other lanes run alongside', () => {
    const { log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [
        { kind: 'checks.run', taskId: 't1', round: 1, checks: [], coverage: false },
        { kind: 'pull_request.open', taskId: 't1' },
        { kind: 'checks.run', taskId: 't2', round: 1, checks: [], coverage: false },
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
    expect(log.settleEffect(first[0]?.id ?? 0, 11)).toBe(true);
    expect(log.claimEffects(12).map((stored) => stored.effect.kind)).toEqual(['pull_request.open']);
    log.close();
  });

  test('a pull request watch runs in its own side lane, beside long work on the same task', () => {
    const { log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [
        { kind: 'pull_request.merge', taskId: 't1', headSha: null },
        { kind: 'pull_request.watch', taskId: 't1' },
        { kind: 'pull_request.watch', taskId: 't1' },
      ],
      0,
      1
    );
    expect(log.claimEffects(1).map((stored) => [stored.lane, stored.effect.kind])).toEqual([
      ['task:t1', 'pull_request.merge'],
      ['side:t1', 'pull_request.watch'],
    ]);
    expect(log.claimEffects(1)).toEqual([]);
    log.close();
  });

  test('a retried effect waits for its time and counts its attempts; a failed one stays failed', () => {
    const { log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [briefing, { kind: 'worktree.remove', taskId: 't' }],
      0,
      1
    );
    const [first, second] = log.claimEffects(1);
    expect(log.retryEffect(first?.id ?? 0, 500, 'busy')).toBe(true);
    expect(log.failEffect(second?.id ?? 0, 2, 'gone')).toBe(true);
    expect(log.selectNextAvailableAt()).toBe(500);
    expect(log.claimEffects(100)).toEqual([]);
    expect(log.claimEffects(500).map((stored) => stored.attempts)).toEqual([2]);
    expect(log.selectNextAvailableAt()).toBeNull();
    expect(log.listEffectStatuses().map((row) => row.status)).toEqual(['running', 'failed']);
    log.close();
  });

  test('a stored effect that cannot be read fails on its own and the lane goes on', () => {
    const { path, log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [
        { kind: 'checks.run', taskId: 't1', round: 1, checks: [], coverage: false },
        { kind: 'pull_request.open', taskId: 't1' },
        { kind: 'pull_request.push', taskId: 't1' },
      ],
      0,
      1
    );
    const db = new Database(path);
    db.run(`UPDATE effects SET payload = '{"kind":"checks.r' WHERE kind = 'checks.run'`);
    db.run(`UPDATE effects SET payload = '{"kind":"pull_request.push"}' WHERE kind = 'pull_request.open'`);
    db.close();
    expect(log.claimEffects(1).map((stored) => stored.effect.kind)).toEqual(['pull_request.push']);
    expect(statuses(log)).toEqual([
      { kind: 'checks.run', status: 'failed', attempts: 0 },
      { kind: 'pull_request.open', status: 'failed', attempts: 0 },
      { kind: 'pull_request.push', status: 'running', attempts: 1 },
    ]);
    log.close();
  });

  test('after a restart, process-bound work is cancelled, interrupted replay-safe work runs again and old rows go', () => {
    const { path, log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [
        { kind: 'run.execute', runId: 'r1' },
        { kind: 'checks.run', taskId: 't1', round: 1, checks: [], coverage: false },
        { kind: 'worktree.remove', taskId: 't2' },
        { kind: 'question.resolve', gateId: 'g1' },
        { kind: 'task.triage', taskId: 't3' },
      ],
      0,
      1
    );
    const claimed = log.claimEffects(1);
    log.settleEffect(claimed[2]?.id ?? 0, 1);
    const db = new Database(path);
    db.run(
      `UPDATE effects SET status = 'pending', attempts = 0 WHERE kind IN ('question.resolve', 'task.triage')`
    );
    db.close();
    const reconciled = log.reconcileAfterRestart(1 + SETTLED_RETENTION_MS + 1);
    expect(reconciled).toEqual({
      requeued: 1,
      failed: 0,
      cancelled: [
        { id: 1, key: 'run.execute:r1', running: true },
        { id: 4, key: 'question.resolve:g1', running: false },
      ],
    });
    expect(statuses(log)).toEqual([
      { kind: 'run.execute', status: 'cancelled', attempts: 1 },
      { kind: 'checks.run', status: 'pending', attempts: 1 },
      { kind: 'question.resolve', status: 'cancelled', attempts: 0 },
      { kind: 'task.triage', status: 'pending', attempts: 0 },
    ]);
    log.close();
    const raw = new Database(path);
    expect(raw.query('SELECT COUNT(*) AS n FROM events').get()).toEqual({ n: 1 });
    raw.close();
  });

  test('an effect another version wrote fails at boot instead of blocking its lane', () => {
    const { path, log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [{ kind: 'pull_request.open', taskId: 't1' }],
      0,
      1
    );
    const db = new Database(path);
    db.run(
      `INSERT INTO effects (key, lane, kind, payload, status, available_at, created_at)
       VALUES ('future:t1', 'task:t1', 'future.kind', '{"kind":"future.kind"}', 'running', 1, 1)`
    );
    db.close();
    expect(log.reconcileAfterRestart(5)).toMatchObject({ failed: 1, requeued: 0 });
    expect(statuses(log)).toEqual([
      { kind: 'pull_request.open', status: 'pending', attempts: 0 },
      { kind: 'future.kind', status: 'failed', attempts: 0 },
    ]);
    expect(log.claimEffects(5).map((stored) => stored.effect.kind)).toEqual(['pull_request.open']);
    log.close();
  });
});

describe('cancelling effects', () => {
  test('a commit cancels the open effects it names for one task, before adding its own', () => {
    const { log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [
        { kind: 'checks.run', taskId: 't1', round: 1, checks: [], coverage: false },
        { kind: 'pull_request.watch', taskId: 't1' },
        { kind: 'checks.run', taskId: 't2', round: 1, checks: [], coverage: false },
      ],
      0,
      1
    );
    log.claimEffects(1);
    const { cancelled } = log.commitCommand({
      events: [{ type: 'project.removed', projectId: 'b' }],
      effects: [{ kind: 'checks.run', taskId: 't1', round: 2, checks: [], coverage: false }],
      cancellations: [{ taskId: 't1', kinds: ['checks.run', 'pull_request.watch'], reason: 'Replaced.' }],
      fromSeq: 1,
      at: 2,
      receipt: null,
    });
    expect(cancelled).toEqual([
      { id: 1, key: expect.stringMatching(/^checks\.run:t1:1:/), running: true },
      { id: 2, key: expect.stringMatching(/^pull_request\.watch:t1:/), running: true },
    ]);
    expect(statuses(log).map((row) => row.status)).toEqual(['cancelled', 'cancelled', 'running', 'pending']);
    log.close();
  });

  test('a cancelled effect keeps its status when its work settles, retries or fails afterwards', () => {
    const { log } = openLog();
    commitEvents(
      log,
      [{ type: 'project.removed', projectId: 'a' }],
      [{ kind: 'checks.run', taskId: 't1', round: 1, checks: [], coverage: false }],
      0,
      1
    );
    const [claimed] = log.claimEffects(1);
    log.commitCommand({
      events: [],
      effects: [],
      cancellations: [{ taskId: 't1', kinds: ['checks.run'], reason: 'The task is finished.' }],
      fromSeq: 1,
      at: 2,
      receipt: null,
    });
    const id = claimed?.id ?? 0;
    expect([log.settleEffect(id, 3), log.retryEffect(id, 3, 'x'), log.failEffect(id, 3, 'x')]).toEqual([
      false,
      false,
      false,
    ]);
    expect(log.selectEffectStatus(claimed?.key ?? '')).toBe('cancelled');
    log.close();
  });
});

describe('command receipts', () => {
  test('a receipt records which events its command committed, and a command with none answers nothing', () => {
    const { log } = openLog();
    log.commitCommand({
      events: [
        { type: 'project.removed', projectId: 'a' },
        { type: 'project.removed', projectId: 'b' },
      ],
      effects: [],
      cancellations: [],
      fromSeq: 0,
      at: 7,
      receipt: receipt('c1'),
    });
    log.commitCommand({
      events: [],
      effects: [],
      cancellations: [],
      fromSeq: 2,
      at: 8,
      receipt: receipt('c2'),
    });
    expect(log.selectReceipt('c1')).toEqual({
      ...receipt('c1'),
      status: 'accepted',
      code: null,
      error: null,
      firstSeq: 1,
      lastSeq: 2,
      at: 7,
    });
    const empty = log.selectReceipt('c2');
    expect(empty).toMatchObject({ firstSeq: 3, lastSeq: 2 });
    expect(log.listEventsBetween(empty?.firstSeq ?? 0, empty?.lastSeq ?? 0)).toEqual([]);
    expect(log.selectReceipt('missing')).toBeNull();
    log.close();
  });

  test('a rejection is recorded once, and the first answer stands', () => {
    const { log } = openLog();
    const rejected = {
      ...receipt('c3'),
      status: 'rejected' as const,
      code: 'gate_closed',
      error: 'This has already been answered.',
      firstSeq: 1,
      lastSeq: 0,
      at: 1,
    };
    log.recordReceipt(rejected);
    log.recordReceipt({ ...rejected, error: 'Something else.' });
    expect(log.selectReceipt('c3')?.error).toBe('This has already been answered.');
    log.close();
  });

  test('receipts older than a week are pruned at boot, like settled effects', () => {
    const { log } = openLog();
    log.commitCommand({
      events: [],
      effects: [],
      cancellations: [],
      fromSeq: 0,
      at: 1,
      receipt: receipt('old'),
    });
    log.commitCommand({
      events: [],
      effects: [],
      cancellations: [],
      fromSeq: 0,
      at: 1 + SETTLED_RETENTION_MS,
      receipt: receipt('new'),
    });
    log.reconcileAfterRestart(2 + SETTLED_RETENTION_MS);
    expect(log.selectReceipt('old')).toBeNull();
    expect(log.selectReceipt('new')).not.toBeNull();
    log.close();
  });
});
