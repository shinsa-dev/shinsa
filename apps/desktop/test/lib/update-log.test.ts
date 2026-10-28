import { describe, expect, it } from 'bun:test';
import {
  describeStateChange,
  formatLogLine,
  needsLogRotation,
  UPDATE_LOG,
} from '../../src/lib/update-log.ts';

const AT = new Date('2026-10-28T10:49:09.484Z');

describe('formatLogLine', () => {
  it('writes one timestamped line per message', () => {
    expect(formatLogLine('info', 'Checking for update', AT)).toBe(
      '2026-10-28T10:49:09.484Z info Checking for update\n'
    );
  });

  it('keeps an error’s stack, or its message when it has none', () => {
    const error = new Error('Code signature invalid');
    expect(formatLogLine('error', error, AT)).toBe(`2026-10-28T10:49:09.484Z error ${error.stack}\n`);
    const bare = new Error('offline');
    bare.stack = undefined;
    expect(formatLogLine('error', bare, AT)).toBe('2026-10-28T10:49:09.484Z error offline\n');
  });

  it('writes anything else as JSON, and what JSON cannot hold as text', () => {
    expect(formatLogLine('debug', { version: '1.3.0' }, AT)).toBe(
      '2026-10-28T10:49:09.484Z debug {"version":"1.3.0"}\n'
    );
    expect(formatLogLine('warn', undefined, AT)).toBe('2026-10-28T10:49:09.484Z warn undefined\n');
  });
});

describe('describeStateChange', () => {
  it('names each new status with its version or failure', () => {
    expect(
      describeStateChange({ status: 'ready', version: '1.3.0' }, { status: 'installing', version: '1.3.0' })
    ).toBe('state ready -> installing 1.3.0');
    expect(
      describeStateChange({ status: 'checking', manual: false }, { status: 'failed', message: 'offline' })
    ).toBe('state checking -> failed: offline');
    expect(describeStateChange({ status: 'checking', manual: true }, { status: 'idle' })).toBe(
      'state checking -> idle'
    );
  });

  it('skips download progress, which keeps the status', () => {
    expect(
      describeStateChange(
        { status: 'downloading', version: '1.3.0', percent: 10 },
        { status: 'downloading', version: '1.3.0', percent: 11 }
      )
    ).toBeNull();
  });
});

describe('needsLogRotation', () => {
  it('starts a new log once the old one passes a megabyte', () => {
    expect(UPDATE_LOG.file).toBe('updater.log');
    expect(needsLogRotation(UPDATE_LOG.limit + 1)).toBe(true);
    expect(needsLogRotation(UPDATE_LOG.limit)).toBe(false);
  });
});
