import { describe, expect, it } from 'bun:test';
import {
  describeClearKey,
  describeFindKey,
  resolveTerminalKey,
  resolveTerminalPageKey,
} from '@/lib/terminal/keys.ts';

type Modifier = 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey';

function press(key: string, ...modifiers: Modifier[]) {
  return {
    key,
    metaKey: modifiers.includes('metaKey'),
    ctrlKey: modifiers.includes('ctrlKey'),
    shiftKey: modifiers.includes('shiftKey'),
    altKey: modifiers.includes('altKey'),
  };
}

const mac = (key: string, ...modifiers: Modifier[]) =>
  resolveTerminalKey(press(key, ...modifiers), true, false);

describe('resolveTerminalKey on a Mac', () => {
  it('gives the shell every key without ⌘ or ⌥, Control ones included', () => {
    expect(mac('k', 'ctrlKey')).toEqual({ type: 'shell' });
    expect(resolveTerminalKey(press('c', 'ctrlKey'), true, true)).toEqual({ type: 'shell' });
    expect(mac('a')).toEqual({ type: 'shell' });
    expect(mac('Home')).toEqual({ type: 'shell' });
    expect(mac('PageUp')).toEqual({ type: 'shell' });
    expect(mac('Enter')).toEqual({ type: 'shell' });
  });

  it('edits the line with ⌘ as Terminal.app and Ghostty do: ⌘⌫ to the start, ⌘← and ⌘→ to either end', () => {
    expect(mac('Backspace', 'metaKey')).toEqual({ type: 'send', data: '\u0015' });
    expect(mac('ArrowLeft', 'metaKey')).toEqual({ type: 'send', data: '\u0001' });
    expect(mac('ArrowRight', 'metaKey')).toEqual({ type: 'send', data: '\u0005' });
    expect(mac('ArrowLeft', 'metaKey', 'shiftKey')).toEqual({ type: 'shinsa' });
  });

  it('moves and deletes by word with ⌥, and treats ⌥ as Meta unless the layout types a character with it', () => {
    expect(mac('Backspace', 'altKey')).toEqual({ type: 'send', data: '\u001b\u007f' });
    expect(mac('ArrowLeft', 'altKey')).toEqual({ type: 'send', data: '\u001bb' });
    expect(mac('ArrowRight', 'altKey')).toEqual({ type: 'send', data: '\u001bf' });
    expect(mac('∫', 'altKey')).toEqual({ type: 'shell' });
    expect(mac('Dead', 'altKey')).toEqual({ type: 'shell' });
    expect(mac('@', 'altKey')).toEqual({ type: 'send', data: '@' });
    expect(mac('{', 'altKey', 'shiftKey')).toEqual({ type: 'send', data: '{' });
    expect(mac('ArrowLeft', 'altKey', 'shiftKey')).toEqual({ type: 'shell' });
    expect(mac('b', 'altKey', 'ctrlKey')).toEqual({ type: 'shell' });
  });

  it('sends a newline for ⇧⏎ and ⌥⏎, so a shell or an agent’s prompt adds a line instead of running it', () => {
    expect(mac('Enter', 'shiftKey')).toEqual({ type: 'send', data: '\u001b\r' });
    expect(mac('Enter', 'altKey')).toEqual({ type: 'send', data: '\u001b\r' });
    expect(mac('Enter', 'shiftKey', 'ctrlKey')).toEqual({ type: 'shell' });
  });

  it('copies only a selection, and keeps paste, find, select all, clear and the font size for the terminal', () => {
    expect(resolveTerminalKey(press('c', 'metaKey'), true, true)).toEqual({ type: 'copy' });
    expect(mac('c', 'metaKey')).toEqual({ type: 'nothing' });
    expect(mac('V', 'metaKey')).toEqual({ type: 'paste' });
    expect(mac('f', 'metaKey')).toEqual({ type: 'find' });
    expect(mac('a', 'metaKey')).toEqual({ type: 'select-all' });
    expect(mac('l', 'metaKey')).toEqual({ type: 'clear' });
    expect(mac('=', 'metaKey')).toEqual({ type: 'font', change: 'larger' });
    expect(mac('+', 'metaKey', 'shiftKey')).toEqual({ type: 'font', change: 'larger' });
    expect(mac('-', 'metaKey')).toEqual({ type: 'font', change: 'smaller' });
    expect(mac('0', 'metaKey')).toEqual({ type: 'font', change: 'reset' });
  });

  it('scrolls the scrollback with ⌘Home, ⌘End, ⌘PageUp and ⌘PageDown', () => {
    expect(mac('Home', 'metaKey')).toEqual({ type: 'scroll', to: 'top' });
    expect(mac('End', 'metaKey')).toEqual({ type: 'scroll', to: 'bottom' });
    expect(mac('PageUp', 'metaKey')).toEqual({ type: 'scroll', to: 'page-up' });
    expect(mac('PageDown', 'metaKey')).toEqual({ type: 'scroll', to: 'page-down' });
  });

  it('leaves every other ⌘ key to Shinsa and the app', () => {
    expect(mac('k', 'metaKey')).toEqual({ type: 'shinsa' });
    expect(mac('t', 'metaKey')).toEqual({ type: 'shinsa' });
    expect(mac('w', 'metaKey')).toEqual({ type: 'shinsa' });
    expect(mac('f', 'metaKey', 'shiftKey')).toEqual({ type: 'shinsa' });
    expect(mac('f', 'metaKey', 'altKey')).toEqual({ type: 'shinsa' });
  });
});

describe('resolveTerminalKey elsewhere', () => {
  const other = (key: string, ...modifiers: Modifier[]) =>
    resolveTerminalKey(press(key, ...modifiers), false, false);

  it('uses Control and Shift for the terminal’s own keys and gives the shell the rest', () => {
    expect(resolveTerminalKey(press('C', 'ctrlKey', 'shiftKey'), false, true)).toEqual({ type: 'copy' });
    expect(other('C', 'ctrlKey', 'shiftKey')).toEqual({ type: 'nothing' });
    expect(other('f', 'ctrlKey', 'shiftKey')).toEqual({ type: 'find' });
    expect(other('L', 'ctrlKey', 'shiftKey')).toEqual({ type: 'clear' });
    expect(other('x', 'ctrlKey', 'shiftKey')).toEqual({ type: 'shell' });
    expect(other('k', 'ctrlKey')).toEqual({ type: 'shell' });
    expect(other('f', 'ctrlKey', 'shiftKey', 'altKey')).toEqual({ type: 'shell' });
    expect(other('Enter', 'shiftKey')).toEqual({ type: 'send', data: '\u001b\r' });
    expect(other('Enter', 'altKey')).toEqual({ type: 'send', data: '\u001b\r' });
  });
});

describe('resolveTerminalPageKey', () => {
  it('opens a tab with ⌘T and closes one with ⌘W on a Mac, and nothing else', () => {
    expect(resolveTerminalPageKey(press('t', 'metaKey'), true)).toBe('new');
    expect(resolveTerminalPageKey(press('W', 'metaKey'), true)).toBe('close');
    expect(resolveTerminalPageKey(press('w', 'metaKey', 'shiftKey'), true)).toBeNull();
    expect(resolveTerminalPageKey(press('k', 'metaKey'), true)).toBeNull();
    expect(resolveTerminalPageKey(press('w', 'ctrlKey'), false)).toBeNull();
  });
});

describe('the key names', () => {
  it('names the find and clear keys for the platform', () => {
    expect(describeFindKey(true)).toBe('⌘F');
    expect(describeFindKey(false)).toBe('Ctrl+Shift+F');
    expect(describeClearKey(true)).toBe('⌘L');
    expect(describeClearKey(false)).toBe('Ctrl+Shift+L');
  });
});
