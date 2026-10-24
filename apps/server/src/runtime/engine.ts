import {
  applyEvent,
  type Decision,
  DomainError,
  decide,
  PROCESS_BOUND_EFFECTS,
  type ReplayFailure,
  replayEventLog,
  type ShinsaCommand,
  type ShinsaEffect,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type {
  CancelledEffect,
  CommandReceipt,
  EventLog,
  StoredEffect,
  UnreadableEvent,
} from '../store/index.ts';

type StateListener = (state: ShinsaState) => void;

export interface EffectContext {
  key: string;
  signal: AbortSignal;
}

type EffectHandler = (effect: ShinsaEffect, context: EffectContext) => Promise<void>;

type ExhaustedHandler = (effect: ShinsaEffect, error: string, key: string) => Promise<void>;

export interface DispatchOptions {
  id?: string;
  onBehalf?: boolean;
  byTask?: string | null;
  receipt?: ShinsaCommand;
}

interface BehalfContext {
  onBehalf: boolean;
  byTask: string | null;
}

type ReceiptIdentity = Pick<CommandReceipt, 'id' | 'type' | 'target' | 'fingerprint'>;

export const MAX_EFFECT_ATTEMPTS = 5;

const MAX_BACKOFF_MS = 30_000;

const IDLE_POLL_MS = 30_000;

const TARGET_FIELDS = ['taskId', 'runId', 'gateId', 'repoId', 'projectId'] as const;

export type LogProblem = (ReplayFailure | UnreadableEvent) & { kind: 'unreadable' | 'unappliable' };

export function resolveBackoff(attempt: number) {
  return Math.min(MAX_BACKOFF_MS, 100 * 2 ** (attempt - 1));
}

function resolveCommandTarget(command: ShinsaCommand) {
  const fields = command as Partial<Record<(typeof TARGET_FIELDS)[number], unknown>>;
  for (const name of TARGET_FIELDS) {
    const value = fields[name];
    if (typeof value === 'string') return `${name}:${value}`;
  }
  return '*';
}

function resolveReceiptIdentity(command: ShinsaCommand, id: string): ReceiptIdentity {
  return {
    id,
    type: command.type,
    target: resolveCommandTarget(command),
    fingerprint: Bun.hash(JSON.stringify(command)).toString(36),
  };
}

function isEmptyDecision(decision: Decision) {
  return decision.events.length === 0 && decision.effects.length === 0 && decision.cancellations.length === 0;
}

export class Engine {
  #state: ShinsaState;
  readonly #problems: LogProblem[];
  #tail: Promise<unknown> = Promise.resolve();
  readonly #log: EventLog;
  readonly #listeners = new Set<StateListener>();
  readonly #running = new Set<Promise<void>>();
  readonly #handlers = new Set<Promise<void>>();
  readonly #controllers = new Map<number, AbortController>();
  #effectHandler: EffectHandler = () => Promise.resolve();
  #exhaustedHandler: ExhaustedHandler = () => Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #started = false;
  #stopped = false;

  constructor(eventLog: EventLog) {
    this.#log = eventLog;
    const read = eventLog.readEvents();
    const replay = replayEventLog(read.events);
    this.#state = replay.state;
    this.#state.seq = Math.max(this.#state.seq, read.lastSeq);
    this.#problems = [
      ...read.unreadable.map((problem) => ({ ...problem, kind: 'unreadable' as const })),
      ...replay.failures.map((problem) => ({ ...problem, kind: 'unappliable' as const })),
    ].sort((a, b) => a.seq - b.seq);
    for (const problem of this.#problems) {
      log.error('[Engine] An event in the log could not be replayed; it was skipped', { ...problem });
    }
  }

  get state() {
    return this.#state;
  }

  get problems(): readonly LogProblem[] {
    return this.#problems;
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
    const reconciled = this.#log.reconcileAfterRestart(Date.now());
    if (reconciled.requeued + reconciled.cancelled.length + reconciled.failed > 0) {
      log.info('[Engine] Recovered the effect outbox after a restart', {
        requeued: reconciled.requeued,
        cancelled: reconciled.cancelled.length,
        failed: reconciled.failed,
      });
    }
    this.#started = true;
    this.#pump();
  }

  stop() {
    this.#started = false;
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    for (const controller of this.#controllers.values()) controller.abort();
  }

  async settle() {
    await this.#tail;
    await Promise.allSettled([...this.#running, ...this.#handlers]);
  }

  dispatch(command: ShinsaCommand, options: DispatchOptions = {}): Promise<ShinsaEvent[]> {
    if (this.#stopped) return Promise.reject(new Error('Shinsa is shutting down.'));
    const supplied = options.id !== undefined;
    const identity = resolveReceiptIdentity(
      options.receipt ?? command,
      options.id ?? `server:${Bun.randomUUIDv7()}`
    );
    const context = { onBehalf: options.onBehalf === true, byTask: options.byTask ?? null };
    const next = this.#tail.then(() => this.#apply(command, identity, supplied, context));
    this.#tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  hasReceipt(id: string) {
    return this.#log.selectReceipt(id) !== null;
  }

  #replay(receipt: CommandReceipt, identity: ReceiptIdentity) {
    if (
      receipt.type !== identity.type ||
      receipt.target !== identity.target ||
      receipt.fingerprint !== identity.fingerprint
    ) {
      throw new DomainError(
        'command_id_conflict',
        `Command id ${identity.id} was already used for ${receipt.type} on ${receipt.target}. Send a different command with a new id.`
      );
    }
    if (receipt.status === 'rejected') {
      throw new DomainError(receipt.code ?? 'command_failed', receipt.error ?? 'The command was refused.');
    }
    return this.#log.listEventsBetween(receipt.firstSeq, receipt.lastSeq);
  }

  #decide(command: ShinsaCommand, identity: ReceiptIdentity, now: number, context: BehalfContext) {
    try {
      return decide(this.#state, command, { now, newId: () => Bun.randomUUIDv7(), ...context });
    } catch (error) {
      this.#log.recordReceipt({
        ...identity,
        status: 'rejected',
        code: error instanceof DomainError ? error.code : 'command_failed',
        error: describeError(error),
        firstSeq: this.#state.seq + 1,
        lastSeq: this.#state.seq,
        at: now,
      });
      throw error;
    }
  }

  #apply(command: ShinsaCommand, identity: ReceiptIdentity, supplied: boolean, context: BehalfContext) {
    const existing = this.#log.selectReceipt(identity.id);
    if (existing) return this.#replay(existing, identity);
    const now = Date.now();
    const decision = this.#decide(command, identity, now, context);
    if (isEmptyDecision(decision) && !supplied) return [];
    const committed = this.#log.commitCommand({
      events: decision.events,
      effects: decision.effects,
      cancellations: decision.cancellations,
      fromSeq: this.#state.seq,
      at: now,
      receipt: identity,
    });
    for (const event of committed.events) this.#state = applyEvent(this.#state, event);
    if (committed.events.length > 0) this.#notify();
    this.#cancelRunning(committed.cancelled);
    if (decision.effects.length > 0) queueMicrotask(() => this.#pump());
    return committed.events;
  }

  #cancelRunning(cancelled: CancelledEffect[]) {
    for (const effect of cancelled) {
      if (effect.running) this.#controllers.get(effect.id)?.abort();
    }
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
    const controller = new AbortController();
    this.#controllers.set(stored.id, controller);
    const cancelled = new Promise<'cancelled'>((resolve) => {
      controller.signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
    });
    const work = (async () =>
      this.#effectHandler(stored.effect, { key: stored.key, signal: controller.signal }))();
    this.#handlers.add(work);
    work.then(
      () => this.#handlers.delete(work),
      () => this.#handlers.delete(work)
    );
    try {
      const outcome = await Promise.race([work.then(() => 'done' as const), cancelled]);
      if (outcome === 'cancelled') {
        this.#reportLateFailure(stored, work);
        return;
      }
      if (this.#started) this.#log.settleEffect(stored.id, Date.now());
    } catch (error) {
      if (this.#started) await this.#recordFailure(stored, describeError(error));
    } finally {
      this.#controllers.delete(stored.id);
    }
  }

  #reportLateFailure(stored: StoredEffect, work: Promise<void>) {
    work.then(
      () => undefined,
      (error: unknown) => {
        log.warn('[Engine] A cancelled effect failed after it was cancelled', {
          kind: stored.effect.kind,
          error: describeError(error),
        });
      }
    );
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
    if (!this.#log.failEffect(stored.id, Date.now(), message)) return;
    try {
      await this.#exhaustedHandler(stored.effect, message, stored.key);
    } catch (error) {
      log.error('[Engine] Could not report a failed effect', { error: describeError(error) });
    }
  }
}
