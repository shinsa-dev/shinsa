import { describe, expect, it } from 'bun:test';
import { isStructurallyEqual } from '@/lib/format/equal.ts';

describe('isStructurallyEqual', () => {
  it('matches the same value and equal primitives', () => {
    const shared = { a: 1 };
    expect(isStructurallyEqual(shared, shared)).toBe(true);
    expect(isStructurallyEqual(1, 1)).toBe(true);
    expect(isStructurallyEqual(Number.NaN, Number.NaN)).toBe(true);
    expect(isStructurallyEqual('a', 'b')).toBe(false);
    expect(isStructurallyEqual(null, {})).toBe(false);
    expect(isStructurallyEqual({}, null)).toBe(false);
    expect(isStructurallyEqual(1, {})).toBe(false);
  });

  it('compares arrays item by item', () => {
    expect(isStructurallyEqual([1, { b: [2] }], [1, { b: [2] }])).toBe(true);
    expect(isStructurallyEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isStructurallyEqual([1, 2], [1, 3])).toBe(false);
    expect(isStructurallyEqual([], {})).toBe(false);
  });

  it('compares plain objects key by key', () => {
    expect(isStructurallyEqual({ a: 1, b: { c: 'x' } }, { b: { c: 'x' }, a: 1 })).toBe(true);
    expect(isStructurallyEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isStructurallyEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(false);
    expect(isStructurallyEqual({ a: { c: 1 } }, { a: { c: 2 } })).toBe(false);
  });

  it('never treats two distinct class instances as equal', () => {
    expect(isStructurallyEqual(new Date(0), new Date(0))).toBe(false);
    expect(isStructurallyEqual(new Map(), {})).toBe(false);
  });
});
