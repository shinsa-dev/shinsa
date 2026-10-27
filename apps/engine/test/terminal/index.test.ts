import { describe, expect, test } from 'bun:test';
import { NO_PROGRESS, resolveTerminal } from '../../src/terminal/index.ts';
import { createSpinner } from '../../src/terminal/spinner.ts';
import { createStyle, PLAIN_STYLE, UNICODE_SYMBOLS } from '../../src/terminal/style.ts';
import { until } from '../helpers/index.ts';

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

  test('progress spins on a terminal’s stderr and stays silent on a pipe', async () => {
    const error = createStream(true);
    const tty = resolveTerminal({}, createStream(true).stream, error.stream);
    const progress = tty.startProgress('Starting the engine');
    await until('a second frame', () => error.written.length > 1);
    progress.stop();
    expect(error.written[0]).toBe('\r\u001b[2K\u001b[36m⠋\u001b[39m \u001b[2mStarting the engine\u001b[22m');
    expect(error.written.at(-1)).toBe('\r\u001b[2K');
    const piped = createStream(false);
    expect(
      resolveTerminal({ FORCE_COLOR: '1' }, createStream(false).stream, piped.stream).startProgress('x')
    ).toBe(NO_PROGRESS);
    expect(piped.written).toEqual([]);
  });

  test('a style without symbols draws no spinner', () => {
    const { stream, written } = createStream(true);
    const progress = createSpinner(stream, PLAIN_STYLE, 'x');
    progress.stop();
    expect(progress).toBe(NO_PROGRESS);
    expect(written).toEqual([]);
    const drawn = createSpinner(stream, createStyle({ color: false, symbols: UNICODE_SYMBOLS }), 'y');
    drawn.stop();
    expect(written).toEqual(['\r\u001b[2K⠋ y', '\r\u001b[2K']);
  });
});
