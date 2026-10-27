import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { describeLogLine, printLogs } from '../../src/cli/logs.ts';
import { PLAIN_DISPLAY } from '../../src/terminal/index.ts';
import { createStyle, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

const COLOR = createStyle({ color: true, symbols: UNICODE_SYMBOLS });

function createLogsIo(home: string, display = PLAIN_DISPLAY) {
  const out: string[] = [];
  return { io: { env: { SHINSA_HOME: home }, display, write: (line = '') => out.push(line) }, out };
}

const ENTRIES = [
  JSON.stringify({ at: '2026-10-26T09:00:00.000Z', level: 'info', message: '[Serve] Listening', port: 5180 }),
  'shinsa engine: Failed to start server. Is port 5180 in use?',
  '',
  JSON.stringify({
    at: '2026-10-26T09:00:05.000Z',
    level: 'warn',
    message: '[Accounts] Could not check your Claude Code login',
    error: 'Claude Code is not installed.',
    retry: { in: 30 },
  }),
];

describe('reading a log line', () => {
  test('a JSON entry reads as its time, level, message and fields; anything else is kept as it is', () => {
    expect(describeLogLine(ENTRIES[0] ?? '')).toBe(
      '2026-10-26 09:00:00  info   [Serve] Listening  port=5180'
    );
    expect(describeLogLine(ENTRIES[3] ?? '')).toBe(
      '2026-10-26 09:00:05  warn   [Accounts] Could not check your Claude Code login  error=Claude Code is not installed.  retry={"in":30}'
    );
    expect(describeLogLine('{"note":"no time"}')).toBe('note=no time');
    expect(describeLogLine('[1,2]')).toBe('[1,2]');
    expect(describeLogLine('null')).toBe('null');
    expect(describeLogLine('plain text')).toBe('plain text');
    expect(describeLogLine('{"level":"trace","message":"x"}')).toBe('trace  x');
  });

  test('in a terminal the time is dim, the level takes its colour and the area is bold', () => {
    expect(describeLogLine(ENTRIES[3] ?? '', COLOR)).toBe(
      '\u001b[2m2026-10-26 09:00:05\u001b[22m  \u001b[33mwarn \u001b[39m  \u001b[1m[Accounts]\u001b[22m Could not check your Claude Code login  \u001b[2merror=\u001b[22mClaude Code is not installed.  \u001b[2mretry=\u001b[22m{"in":30}'
    );
    expect(describeLogLine('{"level":"error","message":"Boom"}', COLOR)).toBe(
      '\u001b[31merror\u001b[39m  Boom'
    );
    expect(describeLogLine('{"level":"trace","message":"x"}', COLOR)).toBe('\u001b[2mtrace\u001b[22m  x');
  });
});

describe('shinsa logs', () => {
  test('prints the last lines of the engine log, read or as written', () => {
    const home = createTempDir();
    writeFiles(home, { 'data/engine.log': `${ENTRIES.join('\n')}\n` });
    const all = createLogsIo(home);
    printLogs([], all.io);
    expect(all.out).toEqual([
      '2026-10-26 09:00:00  info   [Serve] Listening  port=5180',
      'shinsa engine: Failed to start server. Is port 5180 in use?',
      '2026-10-26 09:00:05  warn   [Accounts] Could not check your Claude Code login  error=Claude Code is not installed.  retry={"in":30}',
    ]);
    const last = createLogsIo(home);
    printLogs(['--lines', '1', '--json'], last.io);
    expect(last.out).toEqual([ENTRIES[3] ?? '']);
  });

  test('a bad line count and a missing log are explained', () => {
    const home = createTempDir();
    const { io } = createLogsIo(home);
    expect(() => printLogs(['--lines', 'all'], io)).toThrow(
      '--lines takes a whole number, such as --lines 200.'
    );
    expect(() => printLogs(['--lines', '0'], io)).toThrow('--lines takes a whole number');
    expect(() => printLogs([], io)).toThrow(
      `There is no engine log at ${join(home, 'data', 'engine.log')} yet. The engine writes it when the Shinsa app runs it; \`bun dev\` prints to its terminal instead.`
    );
  });
});
