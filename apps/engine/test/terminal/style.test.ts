import { describe, expect, test } from 'bun:test';
import {
  ASCII_SYMBOLS,
  createStyle,
  describeInline,
  describeMark,
  PLAIN_STYLE,
  paintTone,
  resolveStyle,
  UNICODE_SYMBOLS,
} from '../../src/terminal/style.ts';

const COLOR = createStyle({ color: true, symbols: UNICODE_SYMBOLS });

describe('when to colour', () => {
  test('a terminal gets colour and symbols, a pipe gets neither', () => {
    expect(resolveStyle({}, true)).toMatchObject({ color: true, symbols: UNICODE_SYMBOLS });
    expect(resolveStyle({}, false)).toMatchObject({ color: false, symbols: null });
  });

  test('NO_COLOR and TERM=dumb turn colour off, and a dumb terminal draws no symbols', () => {
    expect(resolveStyle({ NO_COLOR: '1' }, true)).toMatchObject({ color: false, symbols: UNICODE_SYMBOLS });
    expect(resolveStyle({ NO_COLOR: '' }, true).color).toBe(true);
    expect(resolveStyle({ TERM: 'dumb' }, true)).toMatchObject({ color: false, symbols: null });
    expect(resolveStyle({ TERM: 'linux' }, true).symbols).toBe(ASCII_SYMBOLS);
  });

  test('FORCE_COLOR wins either way, and forcing it on a pipe draws symbols too', () => {
    expect(resolveStyle({ FORCE_COLOR: '1', NO_COLOR: '1' }, false)).toMatchObject({
      color: true,
      symbols: UNICODE_SYMBOLS,
    });
    expect(resolveStyle({ FORCE_COLOR: '0' }, true).color).toBe(false);
    expect(resolveStyle({ FORCE_COLOR: 'false' }, true).color).toBe(false);
  });
});

describe('painting', () => {
  test('each tone is one of the 16 terminal colours, so it follows the theme', () => {
    expect(COLOR.bold('a')).toBe('\u001b[1ma\u001b[22m');
    expect(COLOR.dim('a')).toBe('\u001b[2ma\u001b[22m');
    expect(paintTone(COLOR, 'accent', 'a')).toBe('\u001b[36ma\u001b[39m');
    expect(paintTone(COLOR, 'success', 'a')).toBe('\u001b[32ma\u001b[39m');
    expect(paintTone(COLOR, 'warning', 'a')).toBe('\u001b[33ma\u001b[39m');
    expect(paintTone(COLOR, 'danger', 'a')).toBe('\u001b[31ma\u001b[39m');
    expect(paintTone(COLOR, 'info', 'a')).toBe('\u001b[34ma\u001b[39m');
    expect(COLOR.bold('')).toBe('');
    expect(PLAIN_STYLE.danger('a')).toBe('a');
  });

  test('a mark leads with its symbol only where symbols are drawn', () => {
    expect(describeMark(COLOR, 'success', 'check', 'Done.')).toBe('\u001b[32m✔\u001b[39m Done.');
    expect(describeMark(PLAIN_STYLE, 'success', 'check', 'Done.')).toBe('Done.');
    const ascii = createStyle({ color: false, symbols: ASCII_SYMBOLS });
    expect(describeMark(ascii, 'danger', 'cross', 'Failed.')).toBe('x Failed.');
  });

  test('code in backticks takes the accent in colour, and keeps its backticks without', () => {
    expect(describeInline(COLOR, 'Run `shinsa start` now.')).toBe(
      'Run \u001b[36mshinsa start\u001b[39m now.'
    );
    expect(describeInline(PLAIN_STYLE, 'Run `shinsa start` now.')).toBe('Run `shinsa start` now.');
  });
});
