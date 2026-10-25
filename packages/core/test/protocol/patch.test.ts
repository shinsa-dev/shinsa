import { describe, expect, test } from 'bun:test';
import {
  applyStatePatch,
  createState,
  decide,
  resolveStatePatch,
  type ShinsaCommand,
  type ShinsaState,
  type StatePatch,
  serializeState,
  type WireState,
} from '../../src/index.ts';
import { buildAll, createHarness, createTask, failing, PASSING, PLAN, registerRepo } from '../harness.ts';

function roundTrip(patch: StatePatch) {
  return JSON.parse(JSON.stringify(patch)) as StatePatch;
}

function plain(state: ShinsaState | WireState) {
  return JSON.parse(JSON.stringify(serializeState(state))) as WireState;
}

describe('state patches', () => {
  test('carry only the entries a command changed, and rebuild the state on the other side', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const taskId = createTask(harness, { repoId });
    let state = harness.state;
    let client = plain(state);
    const commands: ShinsaCommand[] = [
      { type: 'task.prioritize', taskId, priority: 'urgent' },
      { type: 'agent.propose_plan', runId: harness.activeRun(taskId).id, document: PLAN },
      { type: 'settings.change', patch: { maxFixRounds: 3 } },
      { type: 'focus.change', projectId: Object.keys(state.projects)[0] ?? null, until: null },
      { type: 'checks.record', taskId, results: PASSING },
      { type: 'repo.remove', repoId },
    ];
    for (const [index, command] of commands.entries()) {
      const decision = decide(state, command, { now: harness.now + index, newId: () => crypto.randomUUID() });
      const patch = roundTrip(resolveStatePatch(state, decision.state, decision.changes));
      expect(patch.from).toBe(state.seq);
      expect(patch.to).toBe(decision.state.seq);
      const next = applyStatePatch(client, patch);
      expect(next).toEqual(plain(decision.state));
      client = next ?? client;
      state = decision.state;
    }
  });

  test('keep every entry and record nothing changed, so a selector of it stays put', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const taskId = createTask(harness, { repoId });
    const other = createTask(harness, { repoId, request: 'Another task' });
    const client = plain(harness.state);
    const decision = decide(
      harness.state,
      { type: 'task.prioritize', taskId, priority: 'low' },
      { now: harness.now + 1, newId: () => 'unused' }
    );
    const next = applyStatePatch(
      client,
      roundTrip(resolveStatePatch(harness.state, decision.state, decision.changes))
    );
    expect(next?.tasks[other]).toBe(client.tasks[other]);
    expect(next?.runs).toBe(client.runs);
    expect(next?.tasks[taskId]?.activity.slice(0, -1)).toEqual(client.tasks[taskId]?.activity ?? []);
    expect(next?.tasks[taskId]?.activity[0]).toBe(client.tasks[taskId]?.activity[0]);
  });

  test('send a list that only grew as the entries it gained', () => {
    const previous = createState();
    const kept = { at: 1, action: 'kept' };
    const dropped = { at: 0, action: 'dropped' };
    const added = { at: 2, action: 'added' };
    const base = { ...previous, onBehalfActions: [dropped, kept] } as unknown as ShinsaState;
    const next = { ...base, seq: 1, onBehalfActions: [kept, added] } as unknown as ShinsaState;
    const patch = resolveStatePatch(base, next, {});
    expect(patch.fields.onBehalfActions).toEqual({ drop: 1, append: [added] });
    expect(applyStatePatch(base, patch)?.onBehalfActions as unknown[]).toEqual([kept, added]);
  });

  test('send a list that changed otherwise whole', () => {
    const base = createState();
    const cases: [unknown[], unknown[]][] = [
      [[1, 2], []],
      [[1, 2], [3]],
      [[1, 2, 3], [2]],
      [
        [1, 2],
        [1, 3],
      ],
    ];
    for (const [before, after] of cases) {
      const previous = { ...base, onBehalfActions: before } as unknown as ShinsaState;
      const next = { ...base, seq: 1, onBehalfActions: after } as unknown as ShinsaState;
      const patch = resolveStatePatch(previous, next, {});
      expect(patch.fields.onBehalfActions).toEqual({ put: after });
      expect(applyStatePatch(previous, patch)?.onBehalfActions as unknown[]).toEqual(after);
    }
  });

  test('add, replace, merge and remove entries, and drop fields that went away', () => {
    const previous = createState();
    previous.taskNumbers = { SW: 1, OPS: 2 };
    previous.sessionUsage = {
      a: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1, costUsd: 1 },
    };
    const next = createState();
    next.seq = 3;
    next.taskNumbers = { SW: 4, NEW: 1 };
    next.sessionUsage = {
      a: {
        inputTokens: 2,
        outputTokens: 1,
        cacheReadTokens: 1,
        cacheWriteTokens: 1,
        costUsd: undefined as unknown as null,
      },
    };
    const patch = resolveStatePatch(previous, next, {
      taskNumbers: ['SW', 'OPS', 'NEW', 'never'],
      sessionUsage: ['a'],
    });
    expect(patch.records.taskNumbers).toEqual({ SW: { put: 4 }, OPS: { remove: true }, NEW: { put: 1 } });
    expect(patch.records.sessionUsage?.a).toEqual({
      fields: { inputTokens: { put: 2 } },
      unset: ['costUsd'],
    });
    const applied = applyStatePatch(plain(previous), roundTrip(patch));
    expect(applied?.taskNumbers).toEqual({ SW: 4, NEW: 1 });
    expect(applied?.sessionUsage.a as unknown).toEqual({
      inputTokens: 2,
      outputTokens: 1,
      cacheReadTokens: 1,
      cacheWriteTokens: 1,
    });
    const removed = createState();
    removed.sessionUsage = { a: { inputTokens: 1 } as never };
    const fewer = resolveStatePatch(removed, createState(), { sessionUsage: ['a'] });
    expect(fewer.records.sessionUsage?.a).toEqual({ remove: true });
    const merged = applyStatePatch(createState(), {
      from: 0,
      to: 1,
      fields: {},
      records: { sessionUsage: { b: { fields: { list: { drop: 0, append: [1] } }, unset: [] } } },
    });
    expect(merged?.sessionUsage.b).toEqual({ list: [1] } as never);
  });

  test('carry a run without its prompts, with the focus of a fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    const before = harness.state;
    const decision = decide(
      before,
      { type: 'checks.record', taskId, results: failing() },
      { now: harness.now + 1, newId: () => 'fix-run' }
    );
    const patch = roundTrip(resolveStatePatch(before, decision.state, decision.changes));
    expect(JSON.stringify(patch)).not.toContain('"prompt"');
    expect(patch.records.runs?.['fix-run']).toEqual({ put: expect.objectContaining({ fixFocus: 'checks' }) });
    const client = applyStatePatch(plain(before), patch);
    expect(client?.runs['fix-run']).not.toHaveProperty('prompt');
    expect(client?.runs['fix-run']?.fixFocus).toBe('checks');
  });

  test('send no change for an entry whose fields all stayed the same', () => {
    const previous = createState();
    previous.sessionUsage = { a: { inputTokens: 1 } as never };
    const next = { ...previous, seq: 1, sessionUsage: { a: { inputTokens: 1 } as never } };
    expect(resolveStatePatch(previous, next, { sessionUsage: ['a'] }).records).toEqual({});
  });

  test('refuse a patch for another version of the state', () => {
    const state = createState();
    expect(applyStatePatch(state, { from: 4, to: 5, fields: {}, records: {} })).toBeNull();
  });
});
