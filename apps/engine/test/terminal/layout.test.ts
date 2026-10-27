import { describe, expect, test } from 'bun:test';
import {
  describeCommandTerm,
  describeFields,
  describeHeading,
  describeList,
  describeParagraph,
  describeTable,
  describeUsageLines,
  PLAIN_DISPLAY,
  resolveTermWidth,
  splitUsage,
} from '../../src/terminal/layout.ts';
import { ASCII_SYMBOLS, createStyle, PLAIN_STYLE, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';

const COLOR = { style: createStyle({ color: true, symbols: UNICODE_SYMBOLS }), width: null };

describe('lists', () => {
  const entries = [
    { term: 'list', text: 'List tasks, most recently changed first.' },
    { term: 'wait-on', text: 'Make a task wait on other tasks.' },
  ];

  test('terms align to the longest, and a pipe keeps each description on one line', () => {
    expect(describeList(PLAIN_DISPLAY, entries)).toEqual([
      '  list     List tasks, most recently changed first.',
      '  wait-on  Make a task wait on other tasks.',
    ]);
    expect(describeList(PLAIN_DISPLAY, [{ term: 'alone', text: '' }])).toEqual(['  alone']);
  });

  test('a description wraps under itself, or below its term when the terminal is narrow', () => {
    const wide = { style: PLAIN_STYLE, width: 44 };
    expect(describeList(wide, entries)).toEqual([
      '  list     List tasks, most recently changed',
      '           first.',
      '  wait-on  Make a task wait on other tasks.',
    ]);
    const narrow = { style: PLAIN_STYLE, width: 30 };
    expect(describeList(narrow, entries.slice(0, 1))).toEqual([
      '  list',
      '      List tasks, most',
      '      recently changed first.',
    ]);
  });

  test('a term longer than the column gets a line of its own', () => {
    const long = 'shinsa accounts sign-in-code-and-more';
    expect(resolveTermWidth([long, 'x'])).toBe(30);
    expect(
      describeList(PLAIN_DISPLAY, [
        { term: long, text: 'Sign in.' },
        { term: 'x', text: 'Y.' },
      ])
    ).toEqual([`  ${long}`, `${' '.repeat(34)}Sign in.`, `  ${'x'.padEnd(32)}Y.`]);
  });
});

describe('tables', () => {
  const rows = [
    ['SW-1', 'Fix the scroll in tab groups', { text: 'Review', tone: 'warning' as const }],
    ['SW-22', 'Add search', { text: 'building', tone: null }],
  ];

  test('columns size to their content, the last one is not padded', () => {
    expect(describeTable(PLAIN_DISPLAY, { headers: ['Task', 'Title', 'Status'], rows })).toEqual([
      'Task   Title                         Status',
      'SW-1   Fix the scroll in tab groups  Review',
      'SW-22  Add search                    building',
    ]);
    expect(describeTable(PLAIN_DISPLAY, { rows: [['a', 'b'], ['c']], indent: 2 })).toEqual(['  a  b', '  c']);
  });

  test('a narrow terminal shrinks the widest column first and never the fixed ones', () => {
    const narrow = { style: PLAIN_STYLE, width: 30 };
    expect(describeTable(narrow, { rows })).toEqual([
      'SW-1   Fix the scro…  Review',
      'SW-22  Add search     building',
    ]);
    const tight = { style: PLAIN_STYLE, width: 10 };
    expect(describeTable(tight, { rows, fixed: [0, 2] })).toEqual([
      'SW-1   Fix the scr…  Review',
      'SW-22  Add search    building',
    ]);
  });

  test('in colour the headers are dim, each cell takes its tone and ASCII symbols bring their ellipsis', () => {
    const [header, first] = describeTable(COLOR, { headers: ['Task', 'Title', 'Status'], rows });
    expect(header).toBe(
      '\u001b[2mTask\u001b[22m   \u001b[2mTitle\u001b[22m                         \u001b[2mStatus\u001b[22m'
    );
    expect(first).toEndWith('\u001b[33mReview\u001b[39m');
    const ascii = { style: createStyle({ color: false, symbols: ASCII_SYMBOLS }), width: 24 };
    expect(describeTable(ascii, { rows: [['SW-1', 'Fix the scroll in tab groups']] })).toEqual([
      'SW-1  Fix the scroll...',
    ]);
  });
});

describe('blocks', () => {
  test('fields align their dim labels', () => {
    expect(
      describeFields(PLAIN_DISPLAY, [
        ['Uptime', '2 hours'],
        ['Data', '~/data'],
      ])
    ).toEqual(['  Uptime  2 hours', '  Data    ~/data']);
    expect(describeFields(COLOR, [['Pid', '1']], 0)).toEqual(['\u001b[2mPid\u001b[22m  1']);
  });

  test('a heading is bold, with its count dim beside it', () => {
    expect(describeHeading(PLAIN_DISPLAY, 'Needs you', 2)).toBe('Needs you  2');
    expect(describeHeading(COLOR, 'Usage')).toBe('\u001b[1mUsage\u001b[22m');
  });

  test('a paragraph wraps inside its indent and can take a tone', () => {
    expect(describeParagraph({ style: PLAIN_STYLE, width: 12 }, 'one two three', 2)).toEqual([
      '  one two',
      '  three',
    ]);
    expect(describeParagraph(COLOR, 'quiet', 0, 'dim')).toEqual(['\u001b[2mquiet\u001b[22m']);
  });
});

describe('usage lines', () => {
  test('the command words take the accent, and its arguments wrap under each other', () => {
    expect(splitUsage('shinsa do <request...> [--urgent | --high]')).toEqual({
      head: ['shinsa', 'do'],
      args: ['<request...>', '[--urgent | --high]'],
    });
    expect(splitUsage('shinsa status')).toEqual({ head: ['shinsa', 'status'], args: [] });
    expect(describeCommandTerm(COLOR, 'shinsa open [task]')).toBe(
      '\u001b[36mshinsa open\u001b[39m \u001b[2m[task]\u001b[22m'
    );
    expect(describeUsageLines(PLAIN_DISPLAY, ['shinsa', 'do'], ['<a>', '[--b]'])).toEqual([
      '  shinsa do <a> [--b]',
    ]);
    expect(
      describeUsageLines({ style: PLAIN_STYLE, width: 22 }, ['shinsa', 'do'], ['<request>', '[--plan-first]'])
    ).toEqual(['  shinsa do <request>', '            [--plan-first]']);
  });
});
