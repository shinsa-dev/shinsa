import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { describeLogLine, printLogs } from '../../src/cli/logs.ts';
import { createTempDir, writeFiles } from '../helpers/index.ts';

function createLogsIo(home: string) {
  const out: string[] = [];
  return { io: { env: { SHINSA_HOME: home }, write: (line = '') => out.push(line) }, out };
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
