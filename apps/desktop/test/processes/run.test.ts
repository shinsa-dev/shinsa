import { describe, expect, it } from 'bun:test';
import { BunServices } from '@effect/platform-bun';
import { Duration, Effect, Option } from 'effect';
import { runProcess } from '../../src/processes/run.ts';

const TIMEOUT = Duration.seconds(5);

function run(program: string, args: string[], timeout = TIMEOUT) {
  return Effect.runPromise(
    runProcess(program, args, { timeout, env: { DESKTOP_RUN: 'seen' } }).pipe(
      Effect.provide(BunServices.layer)
    )
  );
}

describe('runProcess', () => {
  it('collects what the program prints, with the variables it is given', async () => {
    const result = await run('/bin/sh', ['-c', 'echo "$DESKTOP_RUN"; echo oops >&2']);
    expect(result).toEqual(Option.some({ ok: true, stdout: 'seen\n', stderr: 'oops\n' }));
  });

  it('reports a failing exit as not ok', async () => {
    const result = await run('/bin/sh', ['-c', 'echo no >&2; exit 3']);
    expect(result).toEqual(Option.some({ ok: false, stdout: '', stderr: 'no\n' }));
  });

  it('gives nothing for a program that is missing or runs past its timeout', async () => {
    expect(await run('/no/such/program', [])).toEqual(Option.none());
    expect(await run('/bin/sleep', ['5'], Duration.millis(50))).toEqual(Option.none());
  });
});
