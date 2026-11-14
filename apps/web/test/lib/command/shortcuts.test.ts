import { describe, expect, it } from 'bun:test';
import {
  type AppKeyPress,
  CHORD_WINDOW_MS,
  describeShortcut,
  resolveAppShortcut,
  resolveShortcutPath,
} from '@/lib/command/shortcuts.ts';

const press = (key: string, patch: Partial<AppKeyPress> = {}): AppKeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  repeat: false,
  timeStamp: 1000,
  target: null,
  ...patch,
});

const field = { tagName: 'INPUT' } as unknown as EventTarget;

describe('resolveAppShortcut', () => {
  it('opens the terminal with ⌘J and Settings with ⌘, on a Mac, and with Ctrl elsewhere', () => {
    expect(resolveAppShortcut(press('j', { metaKey: true }), null, true)).toEqual({
      kind: 'go',
      target: 'terminal',
    });
    expect(resolveAppShortcut(press(',', { metaKey: true }), null, true)).toEqual({
      kind: 'go',
      target: 'settings',
    });
    expect(resolveAppShortcut(press('J', { ctrlKey: true }), null, false)).toEqual({
      kind: 'go',
      target: 'terminal',
    });
    expect(resolveAppShortcut(press('j', { ctrlKey: true }), null, true)).toEqual({ kind: 'none' });
    expect(resolveAppShortcut(press('j', { metaKey: true }), null, false)).toEqual({ kind: 'none' });
  });

  it('leaves modified keys with Shift or Option, repeats and handled keys alone', () => {
    expect(resolveAppShortcut(press('j', { metaKey: true, shiftKey: true }), null, true).kind).toBe('none');
    expect(resolveAppShortcut(press('j', { metaKey: true, altKey: true }), null, true).kind).toBe('none');
    expect(resolveAppShortcut(press('j', { metaKey: true, repeat: true }), null, true).kind).toBe('none');
    expect(resolveAppShortcut(press('j', { metaKey: true, defaultPrevented: true }), null, true).kind).toBe(
      'none'
    );
    expect(resolveAppShortcut(press('x', { metaKey: true }), null, true).kind).toBe('none');
  });

  it('works in a text field for ⌘J, but never starts a G chord there', () => {
    expect(resolveAppShortcut(press('j', { metaKey: true, target: field }), null, true).kind).toBe('go');
    expect(resolveAppShortcut(press('g', { target: field }), null, true).kind).toBe('none');
    const editable = { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget;
    expect(resolveAppShortcut(press('g', { target: editable }), null, true).kind).toBe('none');
  });

  it('goes Home, to All tasks or to Settings with G then H, T or S', () => {
    const pending = resolveAppShortcut(press('g'), null, true);
    expect(pending).toEqual({ kind: 'pending', chord: { first: 'g', at: 1000 } });
    if (pending.kind !== 'pending') return;
    const then = (key: string) => resolveAppShortcut(press(key, { timeStamp: 1200 }), pending.chord, true);
    expect(then('h')).toEqual({ kind: 'go', target: 'home' });
    expect(then('t')).toEqual({ kind: 'go', target: 'tasks' });
    expect(then('S')).toEqual({ kind: 'go', target: 'settings' });
    expect(then('x')).toEqual({ kind: 'none' });
    expect(then('g')).toEqual({ kind: 'pending', chord: { first: 'g', at: 1200 } });
  });

  it('forgets a G pressed too long ago, and needs the G first', () => {
    const chord = { first: 'g', at: 1000 };
    const late = press('h', { timeStamp: 1000 + CHORD_WINDOW_MS + 1 });
    expect(resolveAppShortcut(late, chord, true)).toEqual({ kind: 'none' });
    expect(resolveAppShortcut(press('h'), null, true)).toEqual({ kind: 'none' });
    expect(resolveAppShortcut(press('h', { metaKey: true }), chord, true)).toEqual({ kind: 'none' });
  });
});

describe('describeShortcut', () => {
  it('names the first shortcut of each move as the Code tab names its keys', () => {
    expect(describeShortcut('terminal', true)).toBe('⌘J');
    expect(describeShortcut('settings', false)).toBe('Ctrl+,');
    expect(describeShortcut('home', true)).toBe('G H');
    expect(describeShortcut('tasks', false)).toBe('G T');
  });
});

describe('resolveShortcutPath', () => {
  it('opens each page', () => {
    expect(resolveShortcutPath('home')).toBe('/');
    expect(resolveShortcutPath('tasks')).toBe('/tasks');
    expect(resolveShortcutPath('settings')).toBe('/settings');
    expect(resolveShortcutPath('terminal')).toStartWith('/terminal');
  });
});
