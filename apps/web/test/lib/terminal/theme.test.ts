import { describe, expect, it } from 'bun:test';
import { SHINSA_APPEARANCE, type TerminalTheme } from '@shinsa/core';
import {
  readDocumentVariable,
  resolveReplyColors,
  resolveShinsaTheme,
  resolveTerminalFont,
  resolveTerminalOptions,
  resolveTerminalTheme,
} from '@/lib/terminal/theme.ts';

const TOKENS: Record<string, string> = {
  '--terminal-background': 'oklch(1 0 0)',
  '--terminal-foreground': 'oklch(0 0 0)',
  '--terminal-cursor': '#2f6fec',
  '--terminal-selection': 'oklch(0.6 0.215 256 / 0.22)',
  '--terminal-ansi-1': '#ff0000',
  '--terminal-ansi-15': 'not a colour',
};

const read = (name: string) => TOKENS[name] ?? '';

const GHOSTTY: TerminalTheme = {
  foreground: '#cdd6f4',
  background: '#1e1e2e',
  cursor: null,
  cursorText: '#1e1e2e',
  selectionBackground: '#585b70',
  selectionForeground: '#cdd6f4',
  palette: ['#45475a', null, '#a6e3a1'],
};

describe('resolveShinsaTheme', () => {
  it('reads the --terminal-* tokens and leaves out what is not a colour', () => {
    expect(resolveShinsaTheme(read)).toEqual({
      background: '#ffffff',
      foreground: '#000000',
      cursor: '#2f6fec',
      selectionBackground: '#007bfc38',
      red: '#ff0000',
    });
  });
});

describe('resolveTerminalTheme', () => {
  it('lays your Ghostty colours over Shinsa’s, for the colour scheme you are in', () => {
    const appearance = { ...SHINSA_APPEARANCE, source: 'ghostty' as const, dark: GHOSTTY };
    expect(resolveTerminalTheme(appearance, 'dark', read)).toMatchObject({
      background: '#1e1e2e',
      foreground: '#cdd6f4',
      cursor: '#2f6fec',
      cursorAccent: '#1e1e2e',
      selectionForeground: '#cdd6f4',
      black: '#45475a',
      red: '#ff0000',
      green: '#a6e3a1',
    });
    expect(resolveTerminalTheme(appearance, 'light', read).background).toBe('#ffffff');
  });
});

describe('resolveTerminalFont', () => {
  it('puts your font first and Shinsa’s mono after it', () => {
    expect(resolveTerminalFont(SHINSA_APPEARANCE)).toBe(
      '"ABC Areal Mono", ui-monospace, "SF Mono", Menlo, monospace'
    );
    expect(resolveTerminalFont({ ...SHINSA_APPEARANCE, fontFamily: 'Iosevka "Term"' })).toStartWith(
      '"Iosevka Term", "ABC Areal Mono"'
    );
  });
});

describe('resolveTerminalOptions', () => {
  it('uses your font size, cursor and option key, or Shinsa’s defaults', () => {
    expect(resolveTerminalOptions(SHINSA_APPEARANCE, 'light', read)).toMatchObject({
      fontSize: 13,
      cursorStyle: 'block',
      cursorBlink: false,
      macOptionIsMeta: false,
      scrollback: 5000,
    });
    expect(
      resolveTerminalOptions(
        { ...SHINSA_APPEARANCE, fontSize: 15, cursorStyle: 'bar', cursorBlink: true, optionAsMeta: true },
        'light',
        read
      )
    ).toMatchObject({ fontSize: 15, cursorStyle: 'bar', cursorBlink: true, macOptionIsMeta: true });
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
