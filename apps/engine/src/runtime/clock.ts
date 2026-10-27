import { DomainError, type ShinsaState } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from './engine.ts';

export interface StateClockOptions {
  now?: () => number;
  minDelayMs?: number;
  maxDelayMs?: number;
}

export interface ClockEntry {
  id: string;
  dueAt: number;
  fire: () => Promise<void>;
}

export interface ClockDefaults {
  area: string;
  failure: string;
  minDelayMs: number;
  maxDelayMs?: number;
}

const MAX_TIMER_MS = 2 ** 31 - 1;

export abstract class StateClock {
  protected readonly engine: Engine;
  protected readonly now: () => number;
  readonly #defaults: ClockDefaults;
  readonly #minDelayMs: number;
  readonly #maxDelayMs: number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #dueAt: number | null = null;
  #unsubscribe: (() => void) | null = null;
  #firing: Promise<void> | null = null;
  readonly #refused = new Set<string>();

  constructor(engine: Engine, defaults: ClockDefaults, options: StateClockOptions) {
    this.engine = engine;
    this.now = options.now ?? Date.now;
    this.#defaults = defaults;
    this.#minDelayMs = options.minDelayMs ?? defaults.minDelayMs;
    this.#maxDelayMs = Math.min(options.maxDelayMs ?? defaults.maxDelayMs ?? MAX_TIMER_MS, MAX_TIMER_MS);
  }

  protected abstract listEntries(state: ShinsaState): ClockEntry[];

  start() {
    this.#unsubscribe ??= this.engine.subscribe(() => this.#schedule());
    this.#schedule();
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#clear();
  }

  protected refuse(id: string) {
    this.#refused.add(id);
  }

  fireDue() {
    this.#firing ??= this.#fireDue().finally(() => {
      this.#firing = null;
      this.#schedule();
    });
    return this.#firing;
  }

  #clear() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    this.#dueAt = null;
  }

  #listLive() {
    const entries = this.listEntries(this.engine.state);
    const listed = new Set(entries.map((entry) => entry.id));
    for (const id of this.#refused) if (!listed.has(id)) this.#refused.delete(id);
    return entries.filter((entry) => !this.#refused.has(entry.id));
  }

  #schedule() {
    if (!this.#unsubscribe) return;
    const entries = this.#listLive();
    if (entries.length === 0) {
      this.#clear();
      return;
    }
    const dueAt = Math.min(...entries.map((entry) => entry.dueAt));
    if (this.#dueAt === dueAt && this.#timer) return;
    this.#clear();
    this.#dueAt = dueAt;
    const delay = Math.min(Math.max(this.#minDelayMs, dueAt - this.now()), this.#maxDelayMs);
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#dueAt = null;
      void this.fireDue();
    }, delay);
    this.#timer.unref();
  }

  async #fireDue() {
    const now = this.now();
    for (const entry of this.#listLive()) {
      if (entry.dueAt > now) continue;
      try {
        await entry.fire();
      } catch (error) {
        if (error instanceof DomainError) this.#refused.add(entry.id);
        log.warn(`[${this.#defaults.area}] ${this.#defaults.failure}`, { error: describeError(error) });
      }
    }
  }
}
