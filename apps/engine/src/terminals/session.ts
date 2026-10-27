import type { TerminalColors, TerminalInfo, TerminalServerFrame } from '@shinsa/core';
import { TerminalMirror } from './mirror.ts';
import type { TerminalProcess, TerminalSpawner } from './pty.ts';

export interface TerminalViewer {
  send: (data: string | Uint8Array) => number;
  buffered: () => number;
  end: () => void;
}

export interface SessionStart {
  command: string[];
  env: Record<string, string>;
  spawn: TerminalSpawner;
  now: number;
}

export interface SessionOptions {
  info: TerminalInfo;
  saved: string | null;
  onChange: (session: TerminalSession) => void;
  onScreen: (session: TerminalSession) => void;
  now: () => number;
}

interface ViewerState {
  behind: boolean;
}

export const FLOW_LIMITS = {
  batchMs: 4,
  batchBytes: 256 * 1024,
  highWater: 4 * 1024 * 1024,
  lowWater: 512 * 1024,
  title: 200,
};

const DEFAULT_SIZE = { cols: 100, rows: 30 };

export const TYPE_LIMITS = { settleMs: 150, waitMs: 5000, keyGapMs: 30 };

const ENTER = '\r';

const ENCODER = new TextEncoder();

function joinChunks(chunks: Uint8Array[]) {
  if (chunks.length === 1) return chunks[0] as Uint8Array;
  const joined = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export class TerminalSession {
  info: TerminalInfo;
  readonly #options: SessionOptions;
  readonly #mirror: TerminalMirror;
  readonly #viewers = new Map<TerminalViewer, ViewerState>();
  #process: TerminalProcess | null = null;
  #batch: Uint8Array[] = [];
  #batchBytes = 0;
  #batchTimer: ReturnType<typeof setTimeout> | null = null;
  #stopping = false;
  #lastOutputAt: number | null = null;
  #disposed = false;

  constructor(options: SessionOptions) {
    this.#options = options;
    this.info = options.info;
    this.#mirror = new TerminalMirror({
      ...DEFAULT_SIZE,
      onReply: (data) => this.#process?.write(data),
      onTitle: (title) => this.#retitle(title),
    });
    if (options.saved) this.#mirror.write(ENCODER.encode(options.saved));
  }

  get running() {
    return this.#process !== null;
  }

  get pid() {
    return this.#process?.pid ?? null;
  }

  get viewers() {
    return this.#viewers.size;
  }

  start({ command, env, spawn, now }: SessionStart) {
    if (this.#process) return;
    if (this.info.endedAt !== null) this.#receive(ENCODER.encode('\r\n'));
    this.#lastOutputAt = null;
    this.#stopping = false;
    this.info = {
      ...this.info,
      status: 'running',
      exitCode: null,
      startedAt: now,
      endedAt: null,
      title: null,
    };
    const process = spawn(command, {
      cwd: this.info.cwd,
      cols: this.#mirror.cols,
      rows: this.#mirror.rows,
      env,
      onData: (data) => this.#receive(data),
    });
    this.#process = process;
    void process.exited.then((code) => this.#end(process, code));
  }

  #end(process: TerminalProcess, code: number | null) {
    if (this.#process !== process) return;
    this.#process = null;
    if (this.#disposed) return;
    this.#flushBatch();
    const status = this.#stopping ? 'stopped' : 'exited';
    this.info = {
      ...this.info,
      status,
      exitCode: this.#stopping ? null : code,
      endedAt: this.#options.now(),
    };
    this.#options.onChange(this);
    this.#options.onScreen(this);
  }

  #retitle(title: string) {
    const next = title.slice(0, FLOW_LIMITS.title) || null;
    if (next === this.info.title) return;
    this.info = { ...this.info, title: next };
    this.#options.onChange(this);
  }

  #receive(data: Uint8Array) {
    if (this.#disposed) return;
    this.#lastOutputAt = performance.now();
    this.#mirror.write(data);
    this.#options.onScreen(this);
    if (this.#viewers.size === 0) return;
    this.#batch.push(data);
    this.#batchBytes += data.length;
    if (this.#batchBytes >= FLOW_LIMITS.batchBytes) this.#flushBatch();
    else this.#batchTimer ??= setTimeout(() => this.#flushBatch(), FLOW_LIMITS.batchMs);
  }

  #flushBatch() {
    if (this.#batchTimer) clearTimeout(this.#batchTimer);
    this.#batchTimer = null;
    if (this.#batch.length === 0) return;
    const frame = joinChunks(this.#batch);
    this.#batch = [];
    this.#batchBytes = 0;
    for (const [viewer, state] of this.#viewers) {
      if (state.behind) continue;
      if (viewer.send(frame) === 0 || viewer.buffered() > FLOW_LIMITS.highWater) state.behind = true;
    }
  }

  #sendScreen(viewer: TerminalViewer) {
    const reset: TerminalServerFrame = { type: 'reset', cols: this.#mirror.cols, rows: this.#mirror.rows };
    viewer.send(JSON.stringify(reset));
    for (const part of this.#mirror.snapshot()) {
      const bytes = typeof part === 'string' ? ENCODER.encode(part) : part;
      if (bytes.length > 0) viewer.send(bytes);
    }
    viewer.send(JSON.stringify({ type: 'live' } satisfies TerminalServerFrame));
  }

  attach(viewer: TerminalViewer) {
    this.#flushBatch();
    this.#viewers.set(viewer, { behind: false });
    this.#sendScreen(viewer);
  }

  detach(viewer: TerminalViewer) {
    this.#viewers.delete(viewer);
  }

  drain(viewer: TerminalViewer) {
    const state = this.#viewers.get(viewer);
    if (!state?.behind || viewer.buffered() > FLOW_LIMITS.lowWater) return;
    this.#flushBatch();
    state.behind = false;
    this.#sendScreen(viewer);
  }

  input(data: string | Uint8Array) {
    this.#process?.write(data);
  }

  type(command: string) {
    const deadline = performance.now() + TYPE_LIMITS.waitMs;
    const attempt = () => {
      const process = this.#process;
      if (!process || this.#disposed) return;
      const settled =
        this.#lastOutputAt !== null && performance.now() - this.#lastOutputAt >= TYPE_LIMITS.settleMs;
      if (!settled && performance.now() < deadline) {
        setTimeout(attempt, TYPE_LIMITS.settleMs);
        return;
      }
      process.write(command);
      setTimeout(() => {
        if (this.#process === process) process.write(ENTER);
      }, TYPE_LIMITS.keyGapMs);
    };
    attempt();
  }

  resize(cols: number, rows: number) {
    if (cols === this.#mirror.cols && rows === this.#mirror.rows) return;
    this.#flushBatch();
    this.#mirror.resize(cols, rows);
    this.#process?.resize(cols, rows);
  }

  clear() {
    this.#mirror.clear();
  }

  replaceColors(colors: TerminalColors) {
    this.#mirror.replaceColors(colors);
  }

  async serializeScreen() {
    await this.#mirror.flush();
    return this.#mirror.serializeSaved();
  }

  hangUp() {
    this.#process?.hangUp();
  }

  stop() {
    this.#stopping = true;
    const process = this.#process;
    process?.hangUp();
    return process?.exited;
  }

  dispose() {
    this.#disposed = true;
    for (const viewer of this.#viewers.keys()) viewer.end();
    if (this.#batchTimer) clearTimeout(this.#batchTimer);
    this.#viewers.clear();
    this.#mirror.dispose();
  }
}
