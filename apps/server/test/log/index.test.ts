import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { describeError, log, redactSecrets } from '../../src/log/index.ts';

const spies: { mockRestore: () => void }[] = [];

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
});

function capture(stream: NodeJS.WriteStream) {
  const lines: string[] = [];
  const spy = spyOn(stream, 'write').mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  spies.push(spy);
  return lines;
}

describe('redactSecrets', () => {
  test('credentials in a URL and GitHub or Anthropic tokens never reach a log', () => {
    expect(redactSecrets('push to https://x-access-token:abc123@github.com/acme/app.git failed')).toBe(
      'push to https://***@github.com/acme/app.git failed'
    );
    expect(redactSecrets(`token ghp_${'a'.repeat(36)} and sk-ant-${'b'.repeat(30)}`)).toBe(
      'token *** and ***'
    );
    expect(redactSecrets('nothing to hide at git@github.com:acme/app')).toBe(
      'nothing to hide at git@github.com:acme/app'
    );
  });
});

describe('describeError', () => {
  test('reads an Error or any thrown value, redacted', () => {
    expect(describeError(new Error('https://me:pw@host/x broke'))).toBe('https://***@host/x broke');
    expect(describeError('plain')).toBe('plain');
  });
});

describe('log', () => {
  test('writes one JSON line per entry, errors to stderr, with secrets removed', () => {
    const out = capture(process.stdout);
    const err = capture(process.stderr);
    log.info('[Test] Info', { url: 'https://u:p@h/r' });
    log.warn('[Test] Warn');
    log.error('[Test] Error', { id: 1 });
    expect(out.map((line) => JSON.parse(line))).toMatchObject([
      { level: 'info', message: '[Test] Info', url: 'https://***@h/r' },
      { level: 'warn', message: '[Test] Warn' },
    ]);
    expect(JSON.parse(err[0] ?? '')).toMatchObject({ level: 'error', message: '[Test] Error', id: 1 });
  });
});
