import { describe, expect, it } from 'bun:test';
import {
  readDocumentVariable,
  resolveFindDecorations,
  resolveReplyColors,
  resolveTerminalFont,
  resolveTerminalOptions,
  resolveTerminalTheme,
} from '@/lib/terminal/theme.ts';

const TOKENS: Record<string, string> = {
  '--terminal-background': 'oklch(1 0 0)',
  '--terminal-foreground': 'oklch(0 0 0)',
  '--terminal-cursor': '#2f6fec',
  '--terminal-selection': 'oklch(0.6 0.215 256 / 0.22)',
  '--terminal-find-match': '#ffcc0026',
  '--terminal-find-active': '#ffcc00',
  '--terminal-ansi-1': '#ff0000',
  '--terminal-ansi-15': 'not a colour',
};

const read = (name: string) => TOKENS[name] ?? '';

describe('resolveTerminalTheme', () => {
  it('reads the --terminal-* tokens and leaves out what is not a colour', () => {
    expect(resolveTerminalTheme(read)).toEqual({
      background: '#ffffff',
      foreground: '#000000',
      cursor: '#2f6fec',
      selectionBackground: '#007bfc38',
      selectionInactiveBackground: '#007bfc38',
      red: '#ff0000',
    });
  });
});

describe('resolveFindDecorations', () => {
  it('marks matches in the Code tab’s find colours, and leaves them to xterm without the tokens', () => {
    expect(resolveFindDecorations(read)).toEqual({
      matchBackground: '#ffcc0026',
      matchOverviewRuler: '#ffcc0026',
      activeMatchBackground: '#ffcc00',
      activeMatchColorOverviewRuler: '#ffcc00',
    });
    expect(resolveFindDecorations(() => '')).toBeUndefined();
  });
});

describe('resolveTerminalOptions', () => {
  it('uses Shinsa’s mono font, the size you chose, a block cursor and ⌥ as Meta', () => {
    expect(resolveTerminalOptions(read, 14)).toMatchObject({
      fontFamily: '"ABC Areal Mono", ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 14,
      cursorStyle: 'block',
      cursorBlink: false,
      macOptionIsMeta: true,
      scrollback: 5000,
    });
    const withFont = (name: string) => (name === '--font-mono' ? ' "Mono Test", monospace ' : read(name));
    expect(resolveTerminalFont(withFont)).toBe('"Mono Test", monospace');
  });
});

describe('resolveReplyColors', () => {
  it('names the colours the engine answers a program’s questions with, as six-digit hex', () => {
    expect(
      resolveReplyColors({ foreground: '#cdd6f4', background: '#1e1e2e80', cursor: 'oklch(1 0 0)' })
    ).toEqual({
      foreground: '#cdd6f4',
      background: '#1e1e2e',
      cursor: '#ffffff',
    });
    expect(resolveReplyColors({})).toEqual({
      foreground: '#1c1c1f',
      background: '#ffffff',
      cursor: '#2f6fec',
    });
  });
});

describe('readDocumentVariable', () => {
  it('reads a custom property off the page', () => {
    document.documentElement.style.setProperty('--terminal-test', '#123456');
    expect(readDocumentVariable('--terminal-test').trim()).toBe('#123456');
    document.documentElement.style.removeProperty('--terminal-test');
  });
});
