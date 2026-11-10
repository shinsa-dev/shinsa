import { describe, expect, it } from 'bun:test';
import { Result } from 'effect';
import { createState, serializeState } from '../../../packages/core/src/index.ts';
import { measureClientApply, measurePushes } from './client.ts';
import { PushRefused } from './schema.ts';

describe('measurePushes', () => {
  const state = serializeState(createState());
  const initial = JSON.stringify({ type: 'state', state });

  it('times every state and patch message the client applies', () => {
    const patch = JSON.stringify({ type: 'state.patch', patch: { from: 0, to: 0, fields: {}, records: {} } });
    const other = JSON.stringify({ type: 'surfaces', desktop: false });
    const measured = measurePushes(initial, [initial, patch, other]);
    expect(Result.isSuccess(measured) && measured.success.n).toBe(3);
  });

  it('refuses a push the client schema would drop, naming the push', () => {
    const unknown = JSON.stringify({ type: 'unknown' });
    const measured = measurePushes(initial, [initial, unknown]);
    expect(Result.isFailure(measured) && measured.failure).toBeInstanceOf(PushRefused);
    expect(Result.isFailure(measured) && measured.failure.message).toContain(unknown);
  });

  it('refuses a first push that is not a state', () => {
    expect(Result.isFailure(measurePushes('not json', []))).toBe(true);
  });
});

describe('measureClientApply', () => {
  it('sizes and times the full and the wire state', () => {
    const measured = measureClientApply(createState());
    expect(measured.fullStateBytes).toBeGreaterThan(0);
    expect(measured.wireStateBytes).toBeGreaterThan(0);
    expect(measured.fullStateParseMs.n).toBe(20);
    expect(measured.wireStateParseMs.n).toBe(20);
  });
});
