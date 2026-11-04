import type { TerminalColors } from '@shinsa/core';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/headless';
import { Effect } from 'effect';

const SCROLLBACK_LINES = 5_000;

const SAVED_LINES = 1_000;

const DEFAULT_COLORS: TerminalColors = { foreground: '#1c1c1f', background: '#ffffff', cursor: '#2f6fec' };

const COLOR_QUERIES: Record<number, keyof TerminalColors> = {
  10: 'foreground',
  11: 'background',
  12: 'cursor',
};

export interface MirrorOptions {
  cols: number;
  rows: number;
  onReply: (data: string) => void;
  onTitle: (title: string) => void;
}

function serializeRgb(hex: string) {
  const channels = [1, 3, 5].map((start) => hex.slice(start, start + 2).repeat(2));
  return `rgb:${channels.join('/')}`;
}

export function createTerminalMirror(options: MirrorOptions) {
  const terminal = new Terminal({
    cols: options.cols,
    rows: options.rows,
    scrollback: SCROLLBACK_LINES,
    allowProposedApi: true,
  });
  const serializer = new SerializeAddon();
  const pending: Uint8Array[] = [];
  let colors: TerminalColors = DEFAULT_COLORS;
  terminal.loadAddon(serializer);
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  terminal.onData(options.onReply);
  terminal.onBinary(options.onReply);
  terminal.onTitleChange(options.onTitle);
  for (const [code, field] of Object.entries(COLOR_QUERIES)) {
    terminal.parser.registerOscHandler(Number(code), (data) => {
      if (data !== '?') return false;
      options.onReply(`\u001b]${code};${serializeRgb(colors[field])}\u001b\\`);
      return true;
    });
  }
  return {
    get cols() {
      return terminal.cols;
    },
    get rows() {
      return terminal.rows;
    },
    write(data: Uint8Array) {
      pending.push(data);
      terminal.write(data, () => {
        pending.shift();
      });
    },
    resize(cols: number, rows: number) {
      terminal.resize(cols, rows);
    },
    clear() {
      terminal.write('', () => terminal.clear());
    },
    replaceColors(next: TerminalColors) {
      colors = next;
    },
    snapshot() {
      return [serializer.serialize(), ...pending];
    },
    serializeSaved() {
      return serializer.serialize({ scrollback: SAVED_LINES });
    },
    readLines(count: number) {
      const buffer = terminal.buffer.active;
      const lines: string[] = [];
      for (let index = 0; index < buffer.length; index++)
        lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
      while (lines.length > 0 && lines.at(-1) === '') lines.pop();
      return lines.slice(-count);
    },
    flushed: Effect.callback<void>((resume) => {
      terminal.write('', () => resume(Effect.void));
    }),
    dispose() {
      terminal.dispose();
    },
  };
}
