import { describe, expect, it } from 'bun:test';
import { createState, serializeState } from '../../../packages/core/src/index.ts';
import { measureClientApply, measurePushes } from './client.ts';

describe('measurePushes', () => {
  it('times every state and patch message', () => {
    const state = serializeState(createState());
    const initial = JSON.stringify({ type: 'state', state });
    const patch = JSON.stringify({ type: 'state.patch', patch: { from: 0, to: 0, fields: {}, records: {} } });
    const other = JSON.stringify({ type: 'surfaces', desktop: false });
    expect(measurePushes(initial, [initial, patch, other]).n).toBe(3);
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
