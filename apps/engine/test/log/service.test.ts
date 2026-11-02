import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Effect } from 'effect';
import { JsonLogger } from '../../src/log/service.ts';

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

function runLogged(effect: Effect.Effect<void>) {
  Effect.runSync(effect.pipe(Effect.provide(JsonLogger)));
}

describe('JsonLogger', () => {
  test('writes Effect logs as one JSON line with the annotations as fields, secrets removed', () => {
    const out = capture(process.stdout);
    runLogged(
      Effect.logInfo('[Test] Pushed', 'twice').pipe(
        Effect.annotateLogs({ taskId: 'T-1', remote: 'https://u:p@github.com/a/b' })
      )
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.endsWith('\n')).toBe(true);
    const entry = JSON.parse(out[0] ?? '');
    expect(Object.keys(entry)).toEqual(['at', 'level', 'message', 'taskId', 'remote']);
    expect(entry).toMatchObject({
      level: 'info',
      message: '[Test] Pushed twice',
      taskId: 'T-1',
      remote: 'https://***@github.com/a/b',
    });
    expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
  });

  test('a fatal log goes to stderr as an error and a debug log is not written', () => {
    const out = capture(process.stdout);
    const err = capture(process.stderr);
    runLogged(Effect.logDebug('[Test] Hidden'));
    runLogged(Effect.logFatal('[Test] Down'));
    expect(out).toEqual([]);
    expect(JSON.parse(err[0] ?? '')).toMatchObject({ level: 'error', message: '[Test] Down' });
  });
});
