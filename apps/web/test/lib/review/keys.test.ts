import { describe, expect, it } from 'bun:test';
import { REVIEW_KEY, resolveReviewKey } from '@/lib/review/keys.ts';

function press(key: string, overrides: Partial<Parameters<typeof resolveReviewKey>[0]> = {}) {
  return resolveReviewKey({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    target: null,
    ...overrides,
  });
}

describe('resolveReviewKey', () => {
  it('steps forward on J and back on K', () => {
    expect(press('j')).toBe(1);
    expect(press('k')).toBe(-1);
    expect(press('x')).toBeNull();
    expect(REVIEW_KEY).toEqual({ next: 'J', previous: 'K' });
  });

  it('leaves the keys alone with a modifier, when handled, or while you type', () => {
    expect(press('j', { metaKey: true })).toBeNull();
    expect(press('j', { ctrlKey: true })).toBeNull();
    expect(press('j', { altKey: true })).toBeNull();
    expect(press('j', { defaultPrevented: true })).toBeNull();
    expect(press('j', { target: document.createElement('textarea') })).toBeNull();
    expect(press('j', { target: document.createElement('input') })).toBeNull();
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(press('k', { target: editable })).toBeNull();
    expect(press('k', { target: document.createElement('div') })).toBe(-1);
    expect(press('k', { target: window })).toBe(-1);
  });
});
