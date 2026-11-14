import { describe, expect, test } from 'bun:test';
import { createState, replayEventLog, serializeState } from '../../src/index.ts';
import {
  ENGINE_STATE_FIELDS,
  createDraft,
  removeEntry,
  STATE_FIELDS,
  STATE_RECORDS,
  sealDraft,
  writeEntry,
} from '../../src/state/draft.ts';
import { createHarness, createTask, registerRepo, decideOrThrow } from '../harness.ts';

describe('state drafts', () => {
  test('name every part of the state, so a patch carries every change', () => {
    expect(new Set(Object.keys(createState()))).toEqual(
      new Set(['seq', ...STATE_RECORDS, ...STATE_FIELDS, ...ENGINE_STATE_FIELDS])
    );
  });

  test('keep the engine-only fields out of every patch and out of the page', () => {
    const state = createState();
    const wire = serializeState(state);
    for (const key of ENGINE_STATE_FIELDS) {
      expect((STATE_FIELDS as readonly string[]).includes(key)).toBe(false);
      expect(Object.hasOwn(wire, key)).toBe(false);
    }
  });

  test('copy a record the first time it is written and leave the state they came from alone', () => {
    const base = createState();
    writeEntry(base, 'taskNumbers', 'SW', 1);
    const draft = createDraft(base);
    writeEntry(draft, 'taskNumbers', 'SW', 2);
    writeEntry(draft, 'taskNumbers', 'OPS', 1);
    removeEntry(draft, 'taskNumbers', 'missing');
    removeEntry(draft, 'repos', 'constructor');
    expect(base.taskNumbers).toEqual({ SW: 1 });
    expect(draft.taskNumbers).toEqual({ SW: 2, OPS: 1 });
    expect(draft.repos).toBe(base.repos);
    expect(sealDraft(draft)).toEqual({ taskNumbers: ['SW', 'OPS'] });
    expect(sealDraft(draft)).toEqual({});
  });

  test('remove an entry from the draft only', () => {
    const base = createState();
    writeEntry(base, 'taskNumbers', 'SW', 1);
    const draft = createDraft(base);
    removeEntry(draft, 'taskNumbers', 'SW');
    expect(draft.taskNumbers).toEqual({});
    expect(base.taskNumbers).toEqual({ SW: 1 });
    expect(sealDraft(draft)).toEqual({ taskNumbers: ['SW'] });
  });

  test('write a state that is not a draft in place', () => {
    const state = createState();
    const record = state.taskNumbers;
    writeEntry(state, 'taskNumbers', 'SW', 1);
    expect(state.taskNumbers).toBe(record);
    expect(sealDraft(state)).toEqual({});
  });

  test('let decide work without copying the whole state, and report what it changed', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    const taskId = createTask(harness, { repoId });
    const before = harness.state;
    const decision = decideOrThrow(
      before,
      { type: 'task.prioritize', taskId, priority: 'urgent' },
      { now: 9_000, newId: () => 'unused' }
    );
    expect(decision.state).not.toBe(before);
    expect(decision.state.tasks[taskId]?.priority).toBe('urgent');
    expect(before.tasks[taskId]?.priority).toBe('normal');
    expect(decision.state.repos).toBe(before.repos);
    expect(decision.state.runs).toBe(before.runs);
    expect(decision.changes).toEqual({ tasks: [taskId], presence: ['0'] });
    const unchanged = decideOrThrow(
      decision.state,
      { type: 'task.prioritize', taskId, priority: 'urgent' },
      { now: 9_001, newId: () => 'unused' }
    );
    expect(unchanged.events).toEqual([]);
    expect(unchanged.state).toBe(decision.state);
    expect(unchanged.changes).toEqual({});
  });

  test('replay onto a state it starts from, as a snapshot is', () => {
    const harness = createHarness();
    registerRepo(harness);
    const [first, ...rest] = harness.events;
    const start = replayEventLog(first ? [first] : []).state;
    expect(replayEventLog(rest, start).state).toEqual(harness.state);
  });
});
