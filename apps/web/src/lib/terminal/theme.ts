import type { TerminalAppearance, TerminalColors, TerminalTheme } from '@shinsa/core';
import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { resolveCssColor } from '@/lib/terminal/color.ts';

export type ColorScheme = 'light' | 'dark';

export type VariableReader = (name: string) => string;

const TERMINAL_SCROLLBACK = 5_000;

const TERMINAL_FONT_SIZE = 13;

const SHINSA_FONT = '"ABC Areal Mono", ui-monospace, "SF Mono", Menlo, monospace';

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

export function resolveShinsaTheme(read: VariableReader): ITheme {
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

function overlayTheme(base: ITheme, over: TerminalTheme): ITheme {
  const theme: ITheme = { ...base };
  const pairs: [keyof ITheme, string | null][] = [
    ['background', over.background],
    ['foreground', over.foreground],
    ['cursor', over.cursor],
    ['cursorAccent', over.cursorText],
    ['selectionBackground', over.selectionBackground],
    ['selectionForeground', over.selectionForeground],
    ...ANSI_NAMES.map((name, index): [keyof ITheme, string | null] => [name, over.palette[index] ?? null]),
  ];
  for (const [key, value] of pairs) if (value) Object.assign(theme, { [key]: value });
  return theme;
}

export function resolveTerminalTheme(
  appearance: TerminalAppearance,
  scheme: ColorScheme,
  read: VariableReader
) {
  const own = appearance[scheme];
  const base = resolveShinsaTheme(read);
  return own ? overlayTheme(base, own) : base;
}

export function resolveTerminalFont(appearance: TerminalAppearance) {
  const family = appearance.fontFamily?.replace(/["\\]/g, '');
  return family ? `"${family}", ${SHINSA_FONT}` : SHINSA_FONT;
}

export function resolveTerminalOptions(
  appearance: TerminalAppearance,
  scheme: ColorScheme,
  read: VariableReader
): ITerminalOptions {
  return {
    allowProposedApi: true,
    scrollback: TERMINAL_SCROLLBACK,
    fontFamily: resolveTerminalFont(appearance),
    fontSize: appearance.fontSize ?? TERMINAL_FONT_SIZE,
    lineHeight: 1.2,
    cursorStyle: appearance.cursorStyle ?? 'block',
    cursorBlink: appearance.cursorBlink ?? false,
    cursorInactiveStyle: 'outline',
    macOptionIsMeta: appearance.optionAsMeta,
    macOptionClickForcesSelection: true,
    rightClickSelectsWord: true,
    drawBoldTextInBrightColors: false,
    minimumContrastRatio: 1,
    theme: resolveTerminalTheme(appearance, scheme, read),
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
