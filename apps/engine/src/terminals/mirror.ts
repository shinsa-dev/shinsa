import type { TerminalColors } from '@shinsa/core';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/headless';

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

export class TerminalMirror {
  readonly #terminal: Terminal;
  readonly #serializer = new SerializeAddon();
  readonly #pending: Uint8Array[] = [];
  #colors: TerminalColors = DEFAULT_COLORS;

  constructor(options: MirrorOptions) {
    this.#terminal = new Terminal({
      cols: options.cols,
      rows: options.rows,
      scrollback: SCROLLBACK_LINES,
      allowProposedApi: true,
    });
    this.#terminal.loadAddon(this.#serializer);
    this.#terminal.loadAddon(new Unicode11Addon());
    this.#terminal.unicode.activeVersion = '11';
    this.#terminal.onData(options.onReply);
    this.#terminal.onBinary(options.onReply);
    this.#terminal.onTitleChange(options.onTitle);
    for (const [code, field] of Object.entries(COLOR_QUERIES)) {
      this.#terminal.parser.registerOscHandler(Number(code), (data) => {
        if (data !== '?') return false;
        options.onReply(`\u001b]${code};${serializeRgb(this.#colors[field])}\u001b\\`);
        return true;
      });
    }
  }

  get cols() {
    return this.#terminal.cols;
  }

  get rows() {
    return this.#terminal.rows;
  }

  write(data: Uint8Array) {
    this.#pending.push(data);
    this.#terminal.write(data, () => {
      this.#pending.shift();
    });
  }

  resize(cols: number, rows: number) {
    this.#terminal.resize(cols, rows);
  }

  clear() {
    this.#terminal.write('', () => this.#terminal.clear());
  }

  replaceColors(colors: TerminalColors) {
    this.#colors = colors;
  }

  snapshot() {
    return [this.#serializer.serialize(), ...this.#pending];
  }

  serializeSaved() {
    return this.#serializer.serialize({ scrollback: SAVED_LINES });
  }

  readLines(count: number) {
    const buffer = this.#terminal.buffer.active;
    const lines: string[] = [];
    for (let index = 0; index < buffer.length; index++)
      lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
    while (lines.length > 0 && lines.at(-1) === '') lines.pop();
    return lines.slice(-count);
  }

  flush() {
    return new Promise<void>((resolve) => this.#terminal.write('', resolve));
  }

  dispose() {
    this.#terminal.dispose();
  }
}
