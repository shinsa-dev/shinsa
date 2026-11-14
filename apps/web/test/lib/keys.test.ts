import { describe, expect, it } from 'bun:test';
import { isCancelKey, isSubmitKey, isTyping } from '@/lib/keys.ts';

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

describe('isTyping', () => {
  it('is true in a text field or editable element and false elsewhere', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    expect(isTyping(document.createElement('input'))).toBe(true);
    expect(isTyping(document.createElement('textarea'))).toBe(true);
    expect(isTyping(document.createElement('select'))).toBe(true);
    expect(isTyping(editable)).toBe(editable.isContentEditable);
    expect(isTyping(document.createElement('button'))).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
