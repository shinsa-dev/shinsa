import {
  applyEvent,
  decide,
  PROCESS_BOUND_EFFECTS,
  replayEvents,
  type ShinsaCommand,
  type ShinsaEffect,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { EventLog, StoredEffect } from '../store/index.ts';

type StateListener = (state: ShinsaState) => void;

type EffectHandler = (effect: ShinsaEffect) => Promise<void>;

type ExhaustedHandler = (effect: ShinsaEffect, error: string) => Promise<void>;

export const MAX_EFFECT_ATTEMPTS = 5;

const MAX_BACKOFF_MS = 30_000;

const IDLE_POLL_MS = 30_000;

export function resolveBackoff(attempt: number) {
  return Math.min(MAX_BACKOFF_MS, 100 * 2 ** (attempt - 1));
}

export class Engine {
  #state: ShinsaState;
  #tail: Promise<unknown> = Promise.resolve();
  readonly #log: EventLog;
  readonly #listeners = new Set<StateListener>();
  readonly #running = new Set<Promise<void>>();
  #effectHandler: EffectHandler = () => Promise.resolve();
  #exhaustedHandler: ExhaustedHandler = () => Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #stopped = false;

  constructor(eventLog: EventLog) {
    this.#log = eventLog;
    this.#state = replayEvents(eventLog.listEvents());
  }

  get state() {
    return this.#state;
  }

  onEffect(handler: EffectHandler) {
    this.#effectHandler = handler;
  }

  onEffectExhausted(handler: ExhaustedHandler) {
    this.#exhaustedHandler = handler;
  }

  subscribe(listener: StateListener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  start() {
    this.#log.reconcileAfterRestart(Date.now());
    this.#started = true;
    this.#pump();
  }

  stop() {
    this.#started = false;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async idle() {
    await this.#tail;
  }

  async settle() {
    await this.#tail;
    await Promise.allSettled([...this.#running]);
  }

  dispatch(command: ShinsaCommand): Promise<ShinsaEvent[]> {
    if (this.#stopped) return Promise.reject(new Error('Shinsa is shutting down.'));
    const next = this.#tail.then(() => this.#apply(command));
    this.#tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  async drain() {
    for (;;) {
      await this.#tail;
      this.#pump();
      if (this.#running.size === 0) return;
      await Promise.race(this.#running);
    }
  }

  #apply(command: ShinsaCommand) {
    const now = Date.now();
    const decision = decide(this.#state, command, { now, newId: () => Bun.randomUUIDv7() });
    if (decision.events.length === 0 && decision.effects.length === 0) return [];
    const events = this.#log.commit(decision.events, decision.effects, this.#state.seq, now);
    for (const event of events) this.#state = applyEvent(this.#state, event);
    if (events.length > 0) this.#notify();
    if (decision.effects.length > 0) queueMicrotask(() => this.#pump());
    return events;
  }

  #notify() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#state);
      } catch (error) {
        log.error('[Engine] A state listener threw', { error: describeError(error) });
      }
    }
  }

  #pump() {
    if (!this.#started) return;
    for (const stored of this.#log.claimEffects(Date.now())) {
      const job: Promise<void> = this.#execute(stored).finally(() => {
        this.#running.delete(job);
        this.#pump();
      });
      this.#running.add(job);
    }
    this.#schedule();
  }

  #schedule() {
    if (this.#timer) clearTimeout(this.#timer);
    const next = this.#log.selectNextAvailableAt();
    const delay = next === null ? IDLE_POLL_MS : Math.max(0, Math.min(IDLE_POLL_MS, next - Date.now()));
    this.#timer = setTimeout(() => this.#pump(), delay);
  }

  async #execute(stored: StoredEffect) {
    try {
      await this.#effectHandler(stored.effect);
      if (this.#started) this.#log.settleEffect(stored.id, Date.now());
    } catch (error) {
      if (this.#started) await this.#recordFailure(stored, describeError(error));
    }
  }

  async #recordFailure(stored: StoredEffect, message: string) {
    const final = PROCESS_BOUND_EFFECTS.has(stored.effect.kind) || stored.attempts >= MAX_EFFECT_ATTEMPTS;
    if (!final) {
      log.warn('[Engine] Effect failed, retrying', {
        kind: stored.effect.kind,
        attempt: stored.attempts,
        error: message,
      });
      this.#log.retryEffect(stored.id, Date.now() + resolveBackoff(stored.attempts), message);
      return;
    }
    log.error('[Engine] Effect failed for good', { kind: stored.effect.kind, error: message });
    this.#log.failEffect(stored.id, Date.now(), message);
    try {
      await this.#exhaustedHandler(stored.effect, message);
    } catch (error) {
      log.error('[Engine] Could not report a failed effect', { error: describeError(error) });
    }
  }
}
