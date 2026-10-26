import { describe, expect, it } from 'bun:test';
import { describeFindKey, resolveTerminalKey } from '@/lib/terminal/keys.ts';

function press(
  key: string,
  modifiers: Partial<Record<'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey', boolean>> = {}
) {
  return { key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers };
}

describe('resolveTerminalKey on a Mac', () => {
  it('gives the shell every key without ⌘, Control ones included', () => {
    expect(resolveTerminalKey(press('k', { ctrlKey: true }), true, false)).toBe('shell');
    expect(resolveTerminalKey(press('c', { ctrlKey: true }), true, true)).toBe('shell');
    expect(resolveTerminalKey(press('a'), true, false)).toBe('shell');
  });

  it('keeps ⌘C, ⌘V, ⌘F and ⌘A for the terminal, and every other ⌘ key for Shinsa and the app', () => {
    expect(resolveTerminalKey(press('c', { metaKey: true }), true, true)).toBe('copy');
    expect(resolveTerminalKey(press('c', { metaKey: true }), true, false)).toBe('shinsa');
    expect(resolveTerminalKey(press('V', { metaKey: true }), true, false)).toBe('paste');
    expect(resolveTerminalKey(press('f', { metaKey: true }), true, false)).toBe('find');
    expect(resolveTerminalKey(press('a', { metaKey: true }), true, false)).toBe('select-all');
    expect(resolveTerminalKey(press('k', { metaKey: true }), true, false)).toBe('shinsa');
    expect(resolveTerminalKey(press('f', { metaKey: true, shiftKey: true }), true, false)).toBe('shinsa');
    expect(resolveTerminalKey(press('f', { metaKey: true, altKey: true }), true, false)).toBe('shinsa');
  });
});

describe('resolveTerminalKey elsewhere', () => {
  it('uses Control and Shift for the terminal’s own keys and gives the shell the rest', () => {
    expect(resolveTerminalKey(press('C', { ctrlKey: true, shiftKey: true }), false, true)).toBe('copy');
    expect(resolveTerminalKey(press('f', { ctrlKey: true, shiftKey: true }), false, false)).toBe('find');
    expect(resolveTerminalKey(press('x', { ctrlKey: true, shiftKey: true }), false, false)).toBe('shell');
    expect(resolveTerminalKey(press('k', { ctrlKey: true }), false, false)).toBe('shell');
    expect(
      resolveTerminalKey(press('f', { ctrlKey: true, shiftKey: true, altKey: true }), false, false)
    ).toBe('shell');
  });
});

describe('describeFindKey', () => {
  it('names the find key for the platform', () => {
    expect(describeFindKey(true)).toBe('⌘F');
    expect(describeFindKey(false)).toBe('Ctrl+Shift+F');
  });
});
