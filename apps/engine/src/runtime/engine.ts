import {
  type Briefing,
  briefingKey,
  type Decision,
  DomainError,
  decide,
  PROCESS_BOUND_EFFECTS,
  replaceBriefing,
  replayEventLog,
  type ShinsaCommand,
  type ShinsaEffect,
  type ShinsaEvent,
  type ShinsaState,
  type StateChanges,
} from '@shinsa/core';
import { createReadOnlyError } from '../instance/index.ts';
import { describeError, log } from '../log/index.ts';
import type { CancelledEffect, CommandReceipt, EventLog, LogProblem, StoredEffect } from '../store/index.ts';
import { resolveRetryPolicy } from './failures.ts';

export interface StateChange {
  previous: ShinsaState;
  changes: StateChanges;
}

type StateListener = (state: ShinsaState, change: StateChange) => void;

export interface EffectContext {
  key: string;
  attempt: number;
  signal: AbortSignal;
}

export interface EffectRetry {
  attempt: number;
  attempts: number;
  retryAt: number;
  error: unknown;
}

type EffectHandler = (effect: ShinsaEffect, context: EffectContext) => Promise<void>;

type ExhaustedHandler = (effect: ShinsaEffect, error: string, key: string) => Promise<void>;

type RetryHandler = (effect: ShinsaEffect, retry: EffectRetry, key: string) => Promise<void>;

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

const SNAPSHOT_EVERY = 2_000;

const SNAPSHOT_QUIET_MS = 3_000;

export interface EngineOptions {
  readOnly?: boolean;
  stateVersion?: string | null;
  snapshotEvery?: number;
  snapshotQuietMs?: number;
}

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
  #retryHandler: RetryHandler = () => Promise.resolve();
  #timer: ReturnType<typeof setTimeout> | null = null;
  #snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  #snapshotSeq = 0;
  #started = false;
  #stopped = false;

  readonly readOnly: boolean;
  readonly #stateVersion: string | null;
  readonly #snapshotEvery: number;
  readonly #snapshotQuietMs: number;

  constructor(eventLog: EventLog, options: EngineOptions = {}) {
    this.#log = eventLog;
    this.readOnly = options.readOnly ?? false;
    this.#stateVersion = options.stateVersion ?? null;
    this.#snapshotEvery = options.snapshotEvery ?? SNAPSHOT_EVERY;
    this.#snapshotQuietMs = options.snapshotQuietMs ?? SNAPSHOT_QUIET_MS;
    if (this.readOnly) {
      const rewritten = eventLog.applyLegacyView();
      if (rewritten > 0)
        log.info('[Engine] Reading events an older Shinsa wrote in their new shape', { rewritten });
    } else {
      const rewritten = eventLog.replaceLegacyEvents();
      if (rewritten > 0) log.info('[Engine] Rewrote events an older Shinsa wrote', { rewritten });
    }
    const snapshot = this.#readSnapshot();
    const read = eventLog.readEvents(snapshot?.seq ?? 0);
    const replay = replayEventLog(read.events, snapshot?.state);
    replay.state.seq = Math.max(replay.state.seq, read.lastSeq);
    this.#state = eventLog
      .listBriefings()
      .reduce((state, { projectId, stored }) => replaceBriefing(state, projectId, stored), replay.state);
    this.#snapshotSeq = snapshot?.seq ?? 0;
    const found = [
      ...read.unreadable.map((problem) => ({ ...problem, kind: 'unreadable' as const })),
      ...replay.failures.map((problem) => ({ ...problem, kind: 'unappliable' as const })),
    ];
    for (const problem of found) {
      log.error('[Engine] An event in the log could not be replayed; it was skipped', { ...problem });
    }
    this.#problems = [...(snapshot?.problems ?? []), ...found].sort((a, b) => a.seq - b.seq);
  }

  #readSnapshot() {
    if (this.#stateVersion === null) return null;
    const snapshot = this.#log.selectSnapshot(this.#stateVersion);
    if (!snapshot || snapshot.ok) return snapshot;
    log.info('[Engine] The state snapshot does not match this log or this version; replaying the whole log', {
      seq: snapshot.seq,
      reason: snapshot.reason,
    });
    return null;
  }

  writeSnapshot() {
    if (this.#snapshotTimer) clearTimeout(this.#snapshotTimer);
    this.#snapshotTimer = null;
    if (this.#stateVersion === null || this.readOnly || this.#state.seq === this.#snapshotSeq) return false;
    try {
      const written = this.#log.writeSnapshot(
        {
          seq: this.#state.seq,
          version: this.#stateVersion,
          payload: JSON.stringify(this.#state),
          problems: [...this.#problems],
        },
        Date.now()
      );
      if (written) this.#snapshotSeq = this.#state.seq;
      return written;
    } catch (error) {
      log.warn('[Engine] Could not write the state snapshot', { error: describeError(error) });
      return false;
    }
  }

  #scheduleSnapshot(threshold: number) {
    if (this.#stateVersion === null || this.readOnly) return;
    if (this.#state.seq - this.#snapshotSeq < threshold) return;
    if (this.#snapshotTimer) clearTimeout(this.#snapshotTimer);
    this.#snapshotTimer = setTimeout(() => this.writeSnapshot(), this.#snapshotQuietMs);
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

  onEffectRetry(handler: RetryHandler) {
    this.#retryHandler = handler;
  }

  subscribe(listener: StateListener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  start() {
    this.#scheduleSnapshot(1);
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
    this.writeSnapshot();
    for (const controller of this.#controllers.values()) controller.abort();
  }

  async settle() {
    await this.#tail;
    await Promise.allSettled([...this.#running, ...this.#handlers]);
  }

  dispatch(command: ShinsaCommand, options: DispatchOptions = {}): Promise<ShinsaEvent[]> {
    if (this.#stopped) return Promise.reject(new Error('Shinsa is shutting down.'));
    if (this.readOnly) return Promise.reject(createReadOnlyError());
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

  writeBriefing(projectId: string | null, written: { text: string; briefing: Briefing }) {
    if (this.#stopped) return Promise.reject(new Error('Shinsa is shutting down.'));
    if (this.readOnly) return Promise.reject(createReadOnlyError());
    const next = this.#tail.then(() => this.#recordBriefing(projectId, written));
    this.#tail = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  #recordBriefing(projectId: string | null, written: { text: string; briefing: Briefing }) {
    const stored = { ...written, at: Date.now() };
    this.#log.writeBriefing(projectId, stored);
    const previous = this.#state;
    this.#state = replaceBriefing(previous, projectId, stored);
    this.#notify({ previous, changes: { briefings: [briefingKey(projectId)] } });
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
    if (committed.events.length > 0) {
      const previous = this.#state;
      this.#state = decision.state;
      this.#notify({ previous, changes: decision.changes });
      this.#scheduleSnapshot(this.#snapshotEvery);
    }
    this.#cancelRunning(committed.cancelled);
    if (decision.effects.length > 0) queueMicrotask(() => this.#pump());
    return committed.events;
  }

  #cancelRunning(cancelled: CancelledEffect[]) {
    for (const effect of cancelled) {
      if (effect.running) this.#controllers.get(effect.id)?.abort();
    }
  }

  #notify(change: StateChange) {
    for (const listener of this.#listeners) {
      try {
        listener(this.#state, change);
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
      this.#effectHandler(stored.effect, {
        key: stored.key,
        attempt: stored.attempts,
        signal: controller.signal,
      }))();
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
      if (this.#started) await this.#recordFailure(stored, error);
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

  async #recordFailure(stored: StoredEffect, error: unknown) {
    const message = describeError(error);
    const policy = resolveRetryPolicy(error);
    const final =
      PROCESS_BOUND_EFFECTS.has(stored.effect.kind) ||
      stored.attempts >= MAX_EFFECT_ATTEMPTS ||
      !policy.retryable;
    if (!final) {
      const retryAt = Date.now() + (policy.delayMs ?? resolveBackoff(stored.attempts));
      log.warn('[Engine] Effect failed, retrying', {
        kind: stored.effect.kind,
        attempt: stored.attempts,
        retryAt,
        error: message,
      });
      await this.#reportRetry(stored, {
        attempt: stored.attempts,
        attempts: MAX_EFFECT_ATTEMPTS,
        retryAt,
        error,
      });
      this.#log.retryEffect(stored.id, retryAt, message);
      return;
    }
    log.error('[Engine] Effect failed for good', { kind: stored.effect.kind, error: message });
    if (!this.#log.failEffect(stored.id, Date.now(), message)) return;
    try {
      await this.#exhaustedHandler(stored.effect, message, stored.key);
    } catch (thrown) {
      log.error('[Engine] Could not report a failed effect', { error: describeError(thrown) });
    }
  }

  async #reportRetry(stored: StoredEffect, retry: EffectRetry) {
    try {
      await this.#retryHandler(stored.effect, retry, stored.key);
    } catch (error) {
      log.warn('[Engine] Could not report an effect retry', {
        kind: stored.effect.kind,
        error: describeError(error),
      });
    }
  }
}
