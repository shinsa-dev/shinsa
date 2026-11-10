import { describe, expect, test } from 'bun:test';
import { Effect, type Scope } from 'effect';
import { TestClock } from 'effect/testing';
import { NO_PROGRESS, resolveTerminal } from '../../src/terminal/index.ts';
import { createSpinner } from '../../src/terminal/spinner.ts';
import { createStyle, PLAIN_STYLE, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';

function spin(effect: Effect.Effect<void, never, Scope.Scope>) {
  return Effect.runPromise(Effect.scoped(effect).pipe(Effect.provide(TestClock.layer())));
}

function createStream(isTTY: boolean, columns?: number) {
  const written: string[] = [];
  return { stream: { isTTY, columns, write: (text: string) => written.push(text) }, written };
}

describe('the terminal', () => {
  test('a terminal gets colour and its own width, a pipe neither, and COLUMNS overrides the width', () => {
    const tty = resolveTerminal(
      { HOME: '/Users/you' },
      createStream(true, 120).stream,
      createStream(true).stream
    );
    expect(tty.display.style.color).toBe(true);
    expect(tty.display.width).toBe(120);
    expect(tty.errorStyle.color).toBe(true);
    expect(tty.home).toBe('/Users/you');
    const piped = resolveTerminal({}, createStream(false, 120).stream, createStream(false).stream);
    expect(piped.display).toMatchObject({ width: null, style: { color: false } });
    expect(
      resolveTerminal({ COLUMNS: '72' }, createStream(false).stream, createStream(false).stream).display.width
    ).toBe(72);
    expect(
      resolveTerminal({ COLUMNS: 'wide' }, createStream(true).stream, createStream(true).stream).display.width
    ).toBeNull();
  });

  test('progress spins on a terminal’s stderr every 80 ms and stays silent on a pipe', async () => {
    const error = createStream(true);
    const tty = resolveTerminal({}, createStream(true).stream, error.stream);
    await spin(
      Effect.gen(function* () {
        yield* tty.startProgress('Starting the engine');
        yield* TestClock.adjust('79 millis');
        expect(error.written).toHaveLength(1);
        yield* TestClock.adjust('1 millis');
        expect(error.written).toHaveLength(2);
        yield* TestClock.adjust('160 millis');
        expect(error.written).toHaveLength(4);
      })
    );
    expect(error.written[0]).toBe('\r\u001b[2K\u001b[36m⠋\u001b[39m \u001b[2mStarting the engine\u001b[22m');
    expect(error.written[1]).toBe('\r\u001b[2K\u001b[36m⠙\u001b[39m \u001b[2mStarting the engine\u001b[22m');
    expect(error.written.at(-1)).toBe('\r\u001b[2K');
    const piped = createStream(false);
    expect(
      resolveTerminal({ FORCE_COLOR: '1' }, createStream(false).stream, piped.stream).startProgress('x')
    ).toBe(NO_PROGRESS);
    expect(piped.written).toEqual([]);
  });

  test('the spinner clears its line when the work fails or is interrupted', async () => {
    const style = createStyle({ color: false, symbols: UNICODE_SYMBOLS });
    const failed = createStream(true);
    const failure = await Effect.runPromiseExit(
      Effect.scoped(Effect.andThen(createSpinner(failed.stream, style, 'x'), Effect.fail('broken')))
    );
    expect(failure._tag).toBe('Failure');
    expect(failed.written).toEqual(['\r\u001b[2K⠋ x', '\r\u001b[2K']);
    const stopped = createStream(true);
    await Effect.runPromiseExit(
      Effect.scoped(Effect.andThen(createSpinner(stopped.stream, style, 'y'), Effect.interrupt))
    );
    expect(stopped.written).toEqual(['\r\u001b[2K⠋ y', '\r\u001b[2K']);
  });

  test('a style without symbols draws no spinner', async () => {
    const { stream, written } = createStream(true);
    const progress = createSpinner(stream, PLAIN_STYLE, 'x');
    expect(progress).toBe(NO_PROGRESS);
    await spin(progress);
    expect(written).toEqual([]);
    await spin(createSpinner(stream, createStyle({ color: false, symbols: UNICODE_SYMBOLS }), 'y'));
    expect(written).toEqual(['\r\u001b[2K⠋ y', '\r\u001b[2K']);
  });
});
