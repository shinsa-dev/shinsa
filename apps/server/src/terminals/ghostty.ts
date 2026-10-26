import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  SHINSA_APPEARANCE,
  type TerminalAppearance,
  type TerminalCursorStyle,
  type TerminalTheme,
} from '@shinsa/core';

type Env = Record<string, string | undefined>;

type FileReader = (path: string) => string | null;

interface GhosttyEntry {
  key: string;
  value: string;
}

interface ThemeChoice {
  light: string;
  dark: string;
}

export interface GhosttyPlaces {
  home: string;
  env: Env;
  resources: string[];
}

const COLOR_KEYS: Record<string, keyof Omit<TerminalTheme, 'palette'>> = {
  foreground: 'foreground',
  background: 'background',
  'cursor-color': 'cursor',
  'cursor-text': 'cursorText',
  'selection-background': 'selectionBackground',
  'selection-foreground': 'selectionForeground',
};

const CURSOR_STYLES: Record<string, TerminalCursorStyle> = {
  block: 'block',
  block_hollow: 'block',
  bar: 'bar',
  underline: 'underline',
};

const PALETTE_SIZE = 16;

const MAX_INCLUDES = 16;

const APP_RESOURCES = '/Applications/Ghostty.app/Contents/Resources/ghostty';

function readText(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

export function parseGhosttyLines(text: string): GhosttyEntry[] {
  const entries: GhosttyEntry[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line
      .slice(equals + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    entries.push({ key, value });
  }
  return entries;
}

export function parseGhosttyColor(value: string) {
  const hex = value.replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) return `#${[...hex].map((digit) => digit + digit).join('')}`;
  return null;
}

function createTheme(): TerminalTheme {
  return {
    foreground: null,
    background: null,
    cursor: null,
    cursorText: null,
    selectionBackground: null,
    selectionForeground: null,
    palette: Array.from({ length: PALETTE_SIZE }, () => null),
  };
}

function applyColor(theme: TerminalTheme, { key, value }: GhosttyEntry) {
  if (key === 'palette') {
    const match = /^(\d+)\s*=\s*(.+)$/.exec(value);
    const index = Number(match?.[1]);
    const color = match?.[2] ? parseGhosttyColor(match[2]) : null;
    if (color && index < PALETTE_SIZE) theme.palette[index] = color;
    return true;
  }
  const field = COLOR_KEYS[key];
  if (!field) return false;
  theme[field] = parseGhosttyColor(value);
  return true;
}

function isThemeEmpty(theme: TerminalTheme) {
  return Object.values(COLOR_KEYS).every((field) => theme[field] === null) && theme.palette.every((c) => !c);
}

function mergeThemes(base: TerminalTheme, over: TerminalTheme): TerminalTheme {
  const merged = { ...base, palette: base.palette.map((color, index) => over.palette[index] ?? color) };
  for (const field of Object.values(COLOR_KEYS)) merged[field] = over[field] ?? base[field];
  return merged;
}

export function parseThemeChoice(value: string): ThemeChoice {
  const parts = Object.fromEntries(
    value.split(',').map((part) => {
      const colon = part.indexOf(':');
      return colon < 0 ? ['', part.trim()] : [part.slice(0, colon).trim(), part.slice(colon + 1).trim()];
    })
  );
  const single = parts[''] ?? '';
  return { light: parts.light ?? single, dark: parts.dark ?? single };
}

export function listGhosttyConfigFiles({ home, env }: GhosttyPlaces) {
  const xdg = env.XDG_CONFIG_HOME || join(home, '.config');
  const support = join(home, 'Library/Application Support/com.mitchellh.ghostty');
  return [
    join(xdg, 'ghostty/config'),
    join(xdg, 'ghostty/config.ghostty'),
    join(support, 'config'),
    join(support, 'config.ghostty'),
  ];
}

function listThemeFolders({ home, env, resources }: GhosttyPlaces) {
  const xdg = env.XDG_CONFIG_HOME || join(home, '.config');
  return [
    join(xdg, 'ghostty/themes'),
    join(home, 'Library/Application Support/com.mitchellh.ghostty/themes'),
    ...resources.map((folder) => join(folder, 'themes')),
  ];
}

function readEntries(path: string, home: string, read: FileReader, seen: Set<string>): GhosttyEntry[] | null {
  const text = read(path);
  if (text === null) return null;
  seen.add(path);
  const entries: GhosttyEntry[] = [];
  const includes: string[] = [];
  for (const entry of parseGhosttyLines(text)) {
    if (entry.key === 'config-file') includes.push(entry.value.replace(/^\?/, ''));
    else entries.push(entry);
  }
  for (const include of includes) {
    const target = resolve(dirname(path), include.replace(/^~(?=\/)/, home));
    if (seen.has(target) || seen.size >= MAX_INCLUDES) continue;
    entries.push(...(readEntries(target, home, read, seen) ?? []));
  }
  return entries;
}

function readThemeFile(name: string, places: GhosttyPlaces, read: FileReader) {
  if (!name) return null;
  const candidates = isAbsolute(name) ? [name] : listThemeFolders(places).map((folder) => join(folder, name));
  for (const candidate of candidates) {
    const text = read(candidate);
    if (text === null) continue;
    const theme = createTheme();
    for (const entry of parseGhosttyLines(text)) applyColor(theme, entry);
    return theme;
  }
  return null;
}

function resolveTheme(name: string, overrides: TerminalTheme, places: GhosttyPlaces, read: FileReader) {
  const base = readThemeFile(name, places, read);
  const theme = base ? mergeThemes(base, overrides) : overrides;
  return isThemeEmpty(theme) ? null : theme;
}

function parseFontSize(value: string) {
  const size = Number.parseFloat(value);
  return Number.isFinite(size) && size >= 6 && size <= 72 ? size : null;
}

export function resolveGhosttyAppearance(
  places: GhosttyPlaces,
  read: FileReader = readText
): TerminalAppearance {
  const seen = new Set<string>();
  const entries = listGhosttyConfigFiles(places).flatMap(
    (path) => readEntries(path, places.home, read, seen) ?? []
  );
  if (seen.size === 0) return { ...SHINSA_APPEARANCE };
  const appearance: TerminalAppearance = { ...SHINSA_APPEARANCE, source: 'ghostty' };
  const overrides = createTheme();
  let theme: ThemeChoice = { light: '', dark: '' };
  for (const entry of entries) {
    if (applyColor(overrides, entry)) continue;
    if (entry.key === 'font-family')
      appearance.fontFamily = entry.value ? (appearance.fontFamily ?? entry.value) : null;
    else if (entry.key === 'font-size') appearance.fontSize = parseFontSize(entry.value);
    else if (entry.key === 'theme') theme = parseThemeChoice(entry.value);
    else if (entry.key === 'cursor-style') appearance.cursorStyle = CURSOR_STYLES[entry.value] ?? null;
    else if (entry.key === 'cursor-style-blink') appearance.cursorBlink = entry.value === 'true';
    else if (entry.key === 'macos-option-as-alt') appearance.optionAsMeta = entry.value !== 'false';
  }
  appearance.light = resolveTheme(theme.light, overrides, places, read);
  appearance.dark = resolveTheme(theme.dark, overrides, places, read);
  return appearance;
}

export function resolveGhosttyPlaces(env: Env = process.env, home = env.HOME ?? homedir()): GhosttyPlaces {
  const resources = [env.GHOSTTY_RESOURCES_DIR, APP_RESOURCES].filter((folder): folder is string =>
    Boolean(folder)
  );
  return { home, env, resources };
}
