import { describe, expect, it } from 'bun:test';
import { isCancelKey, isSubmitKey } from '@/lib/keys.ts';

function press(key: string, shiftKey = false, isComposing = false) {
  return { key, shiftKey, nativeEvent: { isComposing } };
}

describe('isSubmitKey', () => {
  it('sends on Enter', () => {
    expect(isSubmitKey(press('Enter'))).toBe(true);
  });

  it('adds a new line on Shift Enter', () => {
    expect(isSubmitKey(press('Enter', true))).toBe(false);
  });

  it('waits while an input method is still composing', () => {
    expect(isSubmitKey(press('Enter', false, true))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isSubmitKey(press('a'))).toBe(false);
  });
});

describe('isCancelKey', () => {
  it('cancels on Escape', () => {
    expect(isCancelKey(press('Escape'))).toBe(true);
  });

  it('leaves Escape to an input method that is still composing', () => {
    expect(isCancelKey(press('Escape', false, true))).toBe(false);
  });

  it('ignores other keys', () => {
    expect(isCancelKey(press('Enter'))).toBe(false);
  });
});
