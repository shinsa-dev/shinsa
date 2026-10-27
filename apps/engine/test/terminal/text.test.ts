import { describe, expect, test } from 'bun:test';
import { createStyle, PLAIN_STYLE, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';
import {
  measureWidth,
  padText,
  shortenHome,
  splitHint,
  stripStyles,
  truncateText,
  wrapText,
} from '../../src/terminal/text.ts';

const COLOR = createStyle({ color: true, symbols: UNICODE_SYMBOLS });

describe('width', () => {
  test('counts what is drawn: no escape codes, one per character', () => {
    expect(measureWidth(COLOR.accent('shinsa'))).toBe(6);
    expect(stripStyles(COLOR.bold('a'))).toBe('a');
    expect(measureWidth('repository’s')).toBe(12);
    expect(padText(COLOR.dim('ab'), 4)).toBe(`${COLOR.dim('ab')}  `);
    expect(padText('abcdef', 4)).toBe('abcdef');
  });

  test('truncation keeps whole characters and ends with the ellipsis', () => {
    expect(truncateText('Fix the scroll', 20)).toBe('Fix the scroll');
    expect(truncateText('Fix the scroll', 9)).toBe('Fix the…');
    expect(truncateText('Fix the scroll', 9, '...')).toBe('Fix th...');
    expect(truncateText('Fix', 1)).toBe('F');
  });
});

describe('wrapping', () => {
  test('breaks between words, keeps code spans whole and leaves a pipe on one line', () => {
    expect(wrapText(PLAIN_STYLE, 'one two three four', 9)).toEqual(['one two', 'three', 'four']);
    expect(wrapText(PLAIN_STYLE, 'run `shinsa tasks list`, then go', 12)).toEqual([
      'run',
      '`shinsa tasks list`,',
      'then go',
    ]);
    expect(wrapText(COLOR, 'run `shinsa start` now', 16)).toEqual([
      `run ${COLOR.accent('shinsa start')}`,
      'now',
    ]);
    expect(wrapText(PLAIN_STYLE, 'one  two\nthree', null)).toEqual(['one two three']);
    expect(wrapText(PLAIN_STYLE, 'a stray ` tick', null)).toEqual(['a stray ` tick']);
  });
});

describe('paths and hints', () => {
  test('the home folder reads as ~', () => {
    expect(shortenHome('/Users/you/.config/shinsa/data', '/Users/you')).toBe('~/.config/shinsa/data');
    expect(shortenHome('/Users/you', '/Users/you')).toBe('~');
    expect(shortenHome('/Users/young/x', '/Users/you')).toBe('/Users/young/x');
    expect(shortenHome('/data', undefined)).toBe('/data');
    expect(shortenHome('/data', '/')).toBe('/data');
  });

  test('an error splits at the first later sentence that names a command', () => {
    expect(splitHint('No task nope. `shinsa tasks list` lists them.')).toEqual({
      message: 'No task nope.',
      hint: '`shinsa tasks list` lists them.',
    });
    expect(splitHint('It broke. Try again. Or run `shinsa logs`.')).toEqual({
      message: 'It broke. Try again.',
      hint: 'Or run `shinsa logs`.',
    });
    expect(splitHint('Run `shinsa start` first.')).toEqual({
      message: 'Run `shinsa start` first.',
      hint: null,
    });
    expect(splitHint('port taken')).toEqual({ message: 'port taken', hint: null });
  });
});
