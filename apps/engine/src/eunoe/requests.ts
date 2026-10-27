import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { ChatNotice } from '@shinsa/core';
import type { EunoeListener } from '../agents/providers/claude/index.ts';
import { describeError, log } from '../log/index.ts';

const POLL_MS = 1_000;

function readSize(path: string) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function readSlice(path: string, from: number, to: number) {
  const fd = openSync(path, 'r');
  try {
    const buffer = Buffer.alloc(to - from);
    const read = readSync(fd, buffer, 0, buffer.length, from);
    return buffer.subarray(0, read).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function parseLine(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function resolveCompactionNotice(record: Record<string, unknown>): ChatNotice | null {
  if (record.compacted !== true) return null;
  const actions = Array.isArray(record.actions) ? record.actions : [];
  return {
    kind: 'compaction',
    trigger: actions.includes('cut') ? 'auto' : 'fold',
    preTokens: null,
    summary: null,
    by: 'eunoe',
  };
}

export class EunoeRequestWatch {
  readonly #path: string;
  readonly #pollMs: number;
  readonly #listeners = new Map<string, Set<EunoeListener>>();
  #offset = 0;
  #partial = '';
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(path: string, pollMs = POLL_MS) {
    this.#path = path;
    this.#pollMs = pollMs;
  }

  watch(sessionId: string, listener: EunoeListener) {
    if (!this.#timer) {
      this.#offset = readSize(this.#path);
      this.#partial = '';
      this.#timer = setInterval(() => this.read(), this.#pollMs);
      this.#timer.unref();
    }
    const listeners = this.#listeners.get(sessionId) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(sessionId, listeners);
    return () => {
      this.read();
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(sessionId);
      if (this.#listeners.size > 0 || !this.#timer) return;
      clearInterval(this.#timer);
      this.#timer = null;
    };
  }

  read() {
    const size = readSize(this.#path);
    if (size < this.#offset) this.#offset = 0;
    if (size === this.#offset) return;
    let text: string;
    try {
      text = readSlice(this.#path, this.#offset, size);
    } catch (error) {
      log.warn('[Eunoe] Could not read the request log', { path: this.#path, error: describeError(error) });
      return;
    }
    this.#offset = size;
    const lines = `${this.#partial}${text}`.split('\n');
    this.#partial = lines.pop() ?? '';
    for (const line of lines) this.#dispatch(line);
  }

  #dispatch(line: string) {
    const record = parseLine(line);
    const thread = record?.thread;
    const notice = record ? resolveCompactionNotice(record) : null;
    if (!notice || typeof thread !== 'string') return;
    for (const [sessionId, listeners] of this.#listeners) {
      if (!thread.startsWith(`${sessionId}-`)) continue;
      for (const listener of listeners) listener(notice);
    }
  }
}
