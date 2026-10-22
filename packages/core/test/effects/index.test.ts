import { describe, expect, test } from 'bun:test';
import {
  PROCESS_BOUND_EFFECTS,
  resolveEffectKey,
  resolveEffectLane,
  type ShinsaEffect,
} from '../../src/index.ts';

const TASK_EFFECTS: ShinsaEffect[] = [
  { kind: 'task.triage', taskId: 't' },
  { kind: 'worktree.create', taskId: 't' },
  { kind: 'worktree.remove', taskId: 't' },
  { kind: 'pull_request.open', taskId: 't' },
  { kind: 'pull_request.push', taskId: 't' },
  { kind: 'pull_request.merge', taskId: 't' },
  { kind: 'pull_request.watch', taskId: 't' },
];

describe('resolveEffectKey', () => {
  test('a run is executed and cancelled once, whatever event asked for it', () => {
    expect(resolveEffectKey({ kind: 'run.execute', runId: 'r' }, 1)).toBe('run.execute:r');
    expect(resolveEffectKey({ kind: 'run.execute', runId: 'r' }, 9)).toBe('run.execute:r');
    expect(resolveEffectKey({ kind: 'run.cancel', runId: 'r' }, 9)).toBe('run.cancel:r');
    expect(resolveEffectKey({ kind: 'question.resolve', gateId: 'g' }, 9)).toBe('question.resolve:g');
  });

  test('repeatable effects are keyed by the event that asked for them', () => {
    expect(resolveEffectKey({ kind: 'run.steer', runId: 'r', text: 'x' }, 4)).toBe('run.steer:r:4');
    expect(resolveEffectKey({ kind: 'checks.run', taskId: 't', round: 2 }, 4)).toBe('checks.run:t:2:4');
    expect(resolveEffectKey({ kind: 'briefing.request', areaId: null }, 4)).toBe('briefing.request:*:4');
    expect(resolveEffectKey({ kind: 'briefing.request', areaId: 'a' }, 4)).toBe('briefing.request:a:4');
    for (const effect of TASK_EFFECTS) {
      expect(resolveEffectKey(effect, 4)).toBe(`${effect.kind}:t:4`);
    }
  });
});

describe('resolveEffectLane', () => {
  test('a run, its cancel and its steers each get a lane, so a cancel never waits behind its session', () => {
    expect(resolveEffectLane({ kind: 'run.execute', runId: 'r' })).toBe('run:r');
    expect(resolveEffectLane({ kind: 'run.cancel', runId: 'r' })).toBe('cancel:r');
    expect(resolveEffectLane({ kind: 'run.steer', runId: 'r', text: 'x' })).toBe('steer:r');
    expect(resolveEffectLane({ kind: 'question.resolve', gateId: 'g' })).toBe('gate:g');
    expect(resolveEffectLane({ kind: 'briefing.request', areaId: 'a' })).toBe('briefing');
  });

  test('everything else about a task runs in order in the task lane', () => {
    for (const effect of [...TASK_EFFECTS, { kind: 'checks.run', taskId: 't', round: 0 } as const]) {
      expect(resolveEffectLane(effect)).toBe('task:t');
    }
  });

  test('only work tied to a live process is process bound', () => {
    expect([...PROCESS_BOUND_EFFECTS].sort()).toEqual([
      'question.resolve',
      'run.cancel',
      'run.execute',
      'run.steer',
    ]);
  });
});
