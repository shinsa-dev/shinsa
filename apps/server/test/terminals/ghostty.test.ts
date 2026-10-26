import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  listGhosttyConfigFiles,
  parseGhosttyColor,
  parseGhosttyLines,
  parseThemeChoice,
  resolveGhosttyAppearance,
  resolveGhosttyPlaces,
} from '../../src/terminals/ghostty.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const HOME = '/home/ada';

const PLACES = { home: HOME, env: {}, resources: ['/app/ghostty'] };

const XDG_CONFIG = `${HOME}/.config/ghostty/config`;

const SUPPORT_CONFIG = `${HOME}/Library/Application Support/com.mitchellh.ghostty/config`;

function readerOf(files: Record<string, string>) {
  return (path: string) => files[path] ?? null;
}

describe('parseGhosttyLines', () => {
  it('reads key = value pairs, skipping comments, blanks and lines without a key', () => {
    expect(
      parseGhosttyLines('# a comment\n\nfont-family = "JetBrains Mono"\nfont-size=14\n= nothing\nbare\n')
    ).toEqual([
      { key: 'font-family', value: 'JetBrains Mono' },
      { key: 'font-size', value: '14' },
    ]);
  });
});

describe('parseGhosttyColor', () => {
  it('reads six and three digit hex, with or without the hash, and nothing else', () => {
    expect(parseGhosttyColor('#1E1E2E')).toBe('#1e1e2e');
    expect(parseGhosttyColor('cdd6f4')).toBe('#cdd6f4');
    expect(parseGhosttyColor('#fa0')).toBe('#ffaa00');
    expect(parseGhosttyColor('rebeccapurple')).toBeNull();
  });
});

describe('parseThemeChoice', () => {
  it('reads one theme for both, or a light and a dark one', () => {
    expect(parseThemeChoice('Catppuccin Mocha')).toEqual({
      light: 'Catppuccin Mocha',
      dark: 'Catppuccin Mocha',
    });
    expect(parseThemeChoice('light:Day, dark:Night')).toEqual({ light: 'Day', dark: 'Night' });
    expect(parseThemeChoice('dark:Night')).toEqual({ light: '', dark: 'Night' });
  });
});

describe('listGhosttyConfigFiles', () => {
  it('reads the XDG folder first and the macOS one after, so the macOS one wins', () => {
    expect(listGhosttyConfigFiles({ ...PLACES, env: { XDG_CONFIG_HOME: '/xdg' } })).toEqual([
      '/xdg/ghostty/config',
      '/xdg/ghostty/config.ghostty',
      SUPPORT_CONFIG,
      `${SUPPORT_CONFIG}.ghostty`,
    ]);
  });
});

describe('resolveGhosttyAppearance', () => {
  it('is Shinsa’s own look when there is no Ghostty config', () => {
    expect(resolveGhosttyAppearance(PLACES, readerOf({}))).toEqual({
      source: 'shinsa',
      fontFamily: null,
      fontSize: null,
      cursorStyle: null,
      cursorBlink: null,
      optionAsMeta: false,
      light: null,
      dark: null,
    });
  });

  it('takes the font, cursor and option key, with a theme and the colours set over it', () => {
    const appearance = resolveGhosttyAppearance(
      PLACES,
      readerOf({
        [XDG_CONFIG]: [
          'font-family = Iosevka',
          'font-family = Fallback Mono',
          'font-size = 15',
          'cursor-style = bar',
          'cursor-style-blink = true',
          'macos-option-as-alt = left',
          'theme = Night',
          'background = #000000',
          'palette = 1=#ff0000',
          'palette = 30=#ffffff',
          'palette = nope',
          'unknown-key = 1',
        ].join('\n'),
        '/app/ghostty/themes/Night': 'background = #1e1e2e\nforeground = #cdd6f4\npalette = 2=#a6e3a1\n',
      })
    );
    expect(appearance).toMatchObject({
      source: 'ghostty',
      fontFamily: 'Iosevka',
      fontSize: 15,
      cursorStyle: 'bar',
      cursorBlink: true,
      optionAsMeta: true,
    });
    expect(appearance.dark).toEqual(appearance.light);
    expect(appearance.dark).toMatchObject({ background: '#000000', foreground: '#cdd6f4' });
    expect(appearance.dark?.palette.slice(0, 3)).toEqual([null, '#ff0000', '#a6e3a1']);
  });

  it('follows a light and a dark theme, finding your own themes before Ghostty’s', () => {
    const appearance = resolveGhosttyAppearance(
      PLACES,
      readerOf({
        [SUPPORT_CONFIG]: 'theme = light:Day,dark:Night\nfont-size = 200\ncursor-style = weird',
        [`${HOME}/.config/ghostty/themes/Day`]: 'background = #ffffff',
        '/app/ghostty/themes/Day': 'background = #eeeeee',
        '/app/ghostty/themes/Night': 'background = #111111',
      })
    );
    expect(appearance.light?.background).toBe('#ffffff');
    expect(appearance.dark?.background).toBe('#111111');
    expect(appearance.fontSize).toBeNull();
    expect(appearance.cursorStyle).toBeNull();
  });

  it('has no theme when neither the theme nor the config sets a colour, and an empty font resets it', () => {
    const appearance = resolveGhosttyAppearance(
      PLACES,
      readerOf({
        [XDG_CONFIG]: 'theme = Missing\nfont-family = Iosevka\nfont-family =\nmacos-option-as-alt = false',
      })
    );
    expect(appearance).toMatchObject({ source: 'ghostty', fontFamily: null, light: null, dark: null });
    expect(appearance.optionAsMeta).toBe(false);
  });

  it('reads included files once, relative to the file, optional ones too, and absolute theme paths', () => {
    const root = createTempDir();
    writeFiles(root, {
      '.config/ghostty/config': 'config-file = ?colors\nconfig-file = ~/extra\nconfig-file = missing',
      '.config/ghostty/colors': 'theme = /themes/Mine\nconfig-file = colors',
      extra: 'font-size = 12',
    });
    const appearance = resolveGhosttyAppearance({ home: root, env: {}, resources: [] }, (path) =>
      path === '/themes/Mine' ? 'cursor-color = #00ff00' : readFile(path)
    );
    expect(appearance.fontSize).toBe(12);
    expect(appearance.light?.cursor).toBe('#00ff00');
  });

  it('reads the real files on disk by default', () => {
    const root = createTempDir();
    writeFiles(root, { '.config/ghostty/config': 'font-family = Menlo' });
    expect(resolveGhosttyAppearance({ home: root, env: {}, resources: [] }).fontFamily).toBe('Menlo');
  });
});

describe('resolveGhosttyPlaces', () => {
  it('looks in the resources folder Ghostty names, then the app’s', () => {
    expect(resolveGhosttyPlaces({ GHOSTTY_RESOURCES_DIR: '/res' }, HOME)).toEqual({
      home: HOME,
      env: { GHOSTTY_RESOURCES_DIR: '/res' },
      resources: ['/res', '/Applications/Ghostty.app/Contents/Resources/ghostty'],
    });
    expect(resolveGhosttyPlaces({ HOME: '/u' }).home).toBe('/u');
    expect(join(resolveGhosttyPlaces({}, HOME).resources[0] ?? '', 'themes')).toContain('Ghostty.app');
  });
});

function readFile(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}
