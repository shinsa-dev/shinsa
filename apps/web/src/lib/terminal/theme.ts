import type { TerminalColors } from '@shinsa/core';
import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { resolveCssColor } from '@/lib/terminal/color.ts';

export type ColorScheme = 'light' | 'dark';

export type VariableReader = (name: string) => string;

const TERMINAL_SCROLLBACK = 5_000;

const MONO_FALLBACK = '"ABC Areal Mono", ui-monospace, "SF Mono", Menlo, monospace';

const ANSI_NAMES = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
] as const;

const FALLBACK: TerminalColors = { foreground: '#1c1c1f', background: '#ffffff', cursor: '#2f6fec' };

export function readDocumentVariable(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

function readToken(read: VariableReader, name: string) {
  return resolveCssColor(read(`--terminal-${name}`));
}

export function resolveTerminalTheme(read: VariableReader): ITheme {
  const theme: ITheme = {};
  const set = (key: keyof ITheme, token: string) => {
    const color = readToken(read, token);
    if (color) Object.assign(theme, { [key]: color });
  };
  set('background', 'background');
  set('foreground', 'foreground');
  set('cursor', 'cursor');
  set('cursorAccent', 'cursor-text');
  set('selectionBackground', 'selection');
  ANSI_NAMES.forEach((name, index) => {
    set(name, `ansi-${index}`);
  });
  return theme;
}

export function resolveTerminalFont(read: VariableReader) {
  return read('--font-mono').trim() || MONO_FALLBACK;
}

export function resolveTerminalOptions(read: VariableReader, fontSize: number): ITerminalOptions {
  return {
    allowProposedApi: true,
    scrollback: TERMINAL_SCROLLBACK,
    fontFamily: resolveTerminalFont(read),
    fontSize,
    lineHeight: 1.25,
    cursorStyle: 'block',
    cursorBlink: false,
    cursorInactiveStyle: 'outline',
    macOptionIsMeta: true,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 1,
    theme: resolveTerminalTheme(read),
  };
}

export function resolveReplyColors(theme: ITheme): TerminalColors {
  const pick = (value: string | undefined, fallback: string) =>
    resolveCssColor(value ?? '')?.slice(0, 7) ?? fallback;
  return {
    foreground: pick(theme.foreground, FALLBACK.foreground),
    background: pick(theme.background, FALLBACK.background),
    cursor: pick(theme.cursor, FALLBACK.cursor),
  };
}
