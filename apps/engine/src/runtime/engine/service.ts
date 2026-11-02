import {
  briefingKey,
  DomainError,
  decide,
  PROCESS_BOUND_EFFECTS,
  replaceBriefing,
  replayEventLog,
  type ShinsaCommand,
  type ShinsaEvent,
  type ShinsaState,
} from '@shinsa/core';
import {
  Cause,
  Clock,
  Context,
  Duration,
  Effect,
  FiberMap,
  Layer,
  Option,
  PubSub,
  Queue,
  Ref,
  type Scope,
  Semaphore,
  Stream,
} from 'effect';
import { createReadOnlyError } from '../../instance/inspect.ts';
import { describeError } from '../../log/redact.ts';
import { Briefings } from '../../store/briefings/service.ts';
import { CommandLog } from '../../store/commands/service.ts';
import { Events } from '../../store/events/service.ts';
import { LOG_MIGRATIONS } from '../../store/migrations/list.ts';
import type { LogVersionError } from '../../store/migrations/schema.ts';
import { LogMigrator } from '../../store/migrations/service.ts';
import type { CancelledEffect, StoredEffect } from '../../store/outbox/schema.ts';
import { Outbox } from '../../store/outbox/service.ts';
import type { CommandReceipt, ReceiptInput } from '../../store/receipts/schema.ts';
import { Receipts } from '../../store/receipts/service.ts';
import type { LogProblem } from '../../store/snapshot/schema.ts';
import { Snapshots } from '../../store/snapshot/service.ts';
import { resolveEffectFailure } from '../failures/classify.ts';
import { resolveEffectRetryDelay } from '../failures/retry.ts';
import { type EffectFailure, MAX_EFFECT_ATTEMPTS } from '../failures/schema.ts';
import { resolveReceiptIdentity } from './receipts.ts';
import {
  type BehalfContext,
  type DispatchOptions,
  type EffectHandlers,
  EngineStopped,
  type EngineOptions,
  IDLE_POLL,
  PUMP_FLOOR,
  ListenerFailed,
  SHUTTING_DOWN,
  SNAPSHOT_EVERY,
  SNAPSHOT_QUIET_MS,
  type StateChange,
  type StateListener,
  type StateUpdate,
  type WrittenBriefing,
} from './schema.ts';

export class EngineCore extends Context.Service<
  EngineCore,
  {
    readonly readOnly: boolean;
    readonly problems: readonly LogProblem[];
    readonly state: Effect.Effect<ShinsaState>;
    readonly updates: Stream.Stream<StateUpdate>;
    observe(listener: StateListener): Effect.Effect<void, never, Scope.Scope>;
    dispatch(
      command: ShinsaCommand,
      options?: DispatchOptions
    ): Effect.Effect<ShinsaEvent[], DomainError | EngineStopped>;
    writeBriefing(
      projectId: string | null,
      written: WrittenBriefing
    ): Effect.Effect<void, DomainError | EngineStopped>;
    hasReceipt(id: string): Effect.Effect<boolean>;
    readonly writeSnapshot: Effect.Effect<boolean>;
    replaceHandlers(handlers: Partial<EffectHandlers>): Effect.Effect<void>;
    readonly start: Effect.Effect<void>;
    readonly stop: Effect.Effect<void>;
    readonly settle: Effect.Effect<void>;
  }
>()('shinsa/engine/runtime/engine/EngineCore') {
  static layer(
    options: EngineOptions = {}
  ): Layer.Layer<
    EngineCore,
    LogVersionError,
    Events | Outbox | Receipts | Briefings | Snapshots | LogMigrator | CommandLog
  > {
    return Layer.effect(
      EngineCore,
      Effect.gen(function* () {
        const events = yield* Events;
        const outbox = yield* Outbox;
        const receipts = yield* Receipts;
        const briefings = yield* Briefings;
        const snapshots = yield* Snapshots;
        const migrator = yield* LogMigrator;
        const commands = yield* CommandLog;
        const scope = yield* Effect.scope;
        const readOnly = options.readOnly ?? false;
        const stateVersion = options.stateVersion ?? null;
        const snapshotEvery = options.snapshotEvery ?? SNAPSHOT_EVERY;
        const snapshotQuiet = Duration.millis(options.snapshotQuietMs ?? SNAPSHOT_QUIET_MS);

        if (readOnly) yield* migrator.assertCurrent(LOG_MIGRATIONS);
        else {
          const migrations = yield* migrator.migrate(LOG_MIGRATIONS);
          yield* Effect.logInfo('[Engine] Migrated the event log').pipe(
            Effect.annotateLogs({ migrations }),
            Effect.when(Effect.succeed(migrations.length > 0))
          );
        }

        const readSnapshot = Effect.gen(function* () {
          if (stateVersion === null) return Option.none();
          const snapshot = yield* snapshots.select(stateVersion);
          if (Option.isNone(snapshot) || snapshot.value.ok) return snapshot;
          yield* Effect.logInfo(
            '[Engine] The state snapshot does not match this log or this version; replaying the whole log'
          ).pipe(Effect.annotateLogs({ seq: snapshot.value.seq, reason: snapshot.value.reason }));
          return Option.none();
        });

        const snapshot = Option.getOrNull(yield* readSnapshot);
        const read = yield* events.read(snapshot?.seq ?? 0);
        const replay = replayEventLog(read.events, snapshot?.ok ? snapshot.state : undefined);
        replay.state.seq = Math.max(replay.state.seq, read.lastSeq);
        const storedBriefings = yield* briefings.list;
        const booted = storedBriefings.reduce(
          (state, { projectId, stored: briefing }) => replaceBriefing(state, projectId, briefing),
          replay.state
        );
        const found: LogProblem[] = [
          ...read.unreadable.map((problem) => ({ ...problem, kind: 'unreadable' as const })),
          ...replay.failures.map((problem) => ({ ...problem, kind: 'unappliable' as const })),
        ];
        for (const problem of found) {
          yield* Effect.logError('[Engine] An event in the log could not be replayed; it was skipped').pipe(
            Effect.annotateLogs({ ...problem })
          );
        }
        const problems = [...(snapshot?.ok ? snapshot.problems : []), ...found].sort((a, b) => a.seq - b.seq);

        const state = yield* Ref.make(booted);
        const snapshotSeq = yield* Ref.make(snapshot?.seq ?? 0);
        const snapshotGeneration = yield* Ref.make(0);
        const started = yield* Ref.make(false);
        const stopped = yield* Ref.make(false);
        const listeners = new Set<StateListener>();
        const handlers = yield* Ref.make<EffectHandlers>({
          apply: () => Effect.void,
          exhausted: () => Effect.void,
          retry: () => Effect.void,
        });
        const updates = yield* PubSub.unbounded<StateUpdate>();
        const wake = yield* Queue.sliding<void>(1);
        const queue = yield* Semaphore.make(1);
        const running = yield* FiberMap.make<number, void, never>();
        const pumping = yield* FiberMap.make<'pump', never, never>();

        const writeSnapshotNow = Effect.gen(function* () {
          const current = yield* Ref.get(state);
          if (stateVersion === null || readOnly || current.seq === (yield* Ref.get(snapshotSeq)))
            return false;
          const at = yield* Clock.currentTimeMillis;
          const written = yield* snapshots
            .write(
              {
                seq: current.seq,
                version: stateVersion,
                payload: JSON.stringify(current),
                problems: [...problems],
              },
              at
            )
            .pipe(
              Effect.catchDefect((error) =>
                Effect.logWarning('[Engine] Could not write the state snapshot').pipe(
                  Effect.annotateLogs({ error: describeError(error) }),
                  Effect.as(false)
                )
              )
            );
          if (written) yield* Ref.set(snapshotSeq, current.seq);
          return written;
        });

        const writeSnapshot = Ref.update(snapshotGeneration, (generation) => generation + 1).pipe(
          Effect.andThen(writeSnapshotNow)
        );

        const scheduleSnapshot = Effect.fnUntraced(function* (threshold: number) {
          if (stateVersion === null || readOnly) return;
          const current = yield* Ref.get(state);
          if (current.seq - (yield* Ref.get(snapshotSeq)) < threshold) return;
          const generation = yield* Ref.updateAndGet(snapshotGeneration, (value) => value + 1);
          yield* Effect.sleep(snapshotQuiet).pipe(
            Effect.andThen(Ref.get(snapshotGeneration)),
            Effect.flatMap((latest) => (latest === generation ? writeSnapshotNow : Effect.succeed(false))),
            Effect.forkIn(scope)
          );
        });

        const notify = Effect.fnUntraced(function* (change: StateChange) {
          const current = yield* Ref.get(state);
          for (const listener of [...listeners]) {
            yield* Effect.try({
              try: () => listener(current, change),
              catch: (error) => new ListenerFailed({ message: describeError(error) }),
            }).pipe(
              Effect.catchTag('ListenerFailed', (failure) =>
                Effect.logError('[Engine] A state listener threw').pipe(
                  Effect.annotateLogs({ error: failure.message })
                )
              )
            );
          }
          yield* PubSub.publish(updates, { ...change, state: current });
        });

        const assertOpen = Effect.gen(function* () {
          if (yield* Ref.get(stopped)) return yield* new EngineStopped({ message: SHUTTING_DOWN });
          if (readOnly) return yield* createReadOnlyError();
        });

        const recordRejection = Effect.fnUntraced(function* (
          identity: ReceiptInput,
          now: number,
          error: unknown
        ) {
          const current = yield* Ref.get(state);
          yield* receipts.record({
            ...identity,
            status: 'rejected',
            code: error instanceof DomainError ? error.code : 'command_failed',
            error: describeError(error),
            firstSeq: current.seq + 1,
            lastSeq: current.seq,
            at: now,
          });
        });

        const replayReceipt = Effect.fnUntraced(function* (receipt: CommandReceipt, identity: ReceiptInput) {
          if (
            receipt.type !== identity.type ||
            receipt.target !== identity.target ||
            receipt.fingerprint !== identity.fingerprint
          ) {
            return yield* new DomainError({
              code: 'command_id_conflict',
              message: `Command id ${identity.id} was already used for ${receipt.type} on ${receipt.target}. Send a different command with a new id.`,
            });
          }
          if (receipt.status === 'rejected') {
            return yield* new DomainError({
              code: receipt.code ?? 'command_failed',
              message: receipt.error ?? 'The command was refused.',
            });
          }
          return yield* events.listBetween(receipt.firstSeq, receipt.lastSeq);
        });

        const cancelRunning = Effect.fnUntraced(function* (cancelled: CancelledEffect[]) {
          for (const effect of cancelled) {
            if (effect.running) yield* FiberMap.remove(running, effect.id);
          }
        });

        const apply = Effect.fnUntraced(function* (
          command: ShinsaCommand,
          identity: ReceiptInput,
          supplied: boolean,
          context: BehalfContext
        ) {
          const existing = yield* receipts.select(identity.id);
          if (Option.isSome(existing)) return yield* replayReceipt(existing.value, identity);
          const now = yield* Clock.currentTimeMillis;
          const current = yield* Ref.get(state);
          const result = yield* Effect.sync(() =>
            decide(current, command, { now, newId: () => Bun.randomUUIDv7(), ...context })
          ).pipe(
            Effect.catchDefect((error) =>
              recordRejection(identity, now, error).pipe(Effect.andThen(Effect.die(error)))
            )
          );
          if (result._tag === 'Failure') {
            yield* recordRejection(identity, now, result.failure);
            return yield* result.failure;
          }
          const decision = result.success;
          const empty =
            decision.events.length === 0 &&
            decision.effects.length === 0 &&
            decision.cancellations.length === 0;
          if (empty && !supplied) return [];
          const committed = yield* commands.commit({
            events: decision.events,
            effects: decision.effects,
            cancellations: decision.cancellations,
            fromSeq: current.seq,
            at: now,
            receipt: identity,
          });
          if (committed.events.length > 0) {
            yield* Ref.set(state, decision.state);
            yield* notify({ previous: current, changes: decision.changes });
            yield* scheduleSnapshot(snapshotEvery);
          }
          yield* cancelRunning(committed.cancelled);
          if (decision.effects.length > 0) yield* Queue.offer(wake, undefined);
          return committed.events;
        });

        const dispatch = Effect.fn('Engine.dispatch')(function* (
          command: ShinsaCommand,
          dispatchOptions: DispatchOptions = {}
        ) {
          yield* assertOpen;
          const identity = resolveReceiptIdentity(
            dispatchOptions.receipt ?? command,
            dispatchOptions.id ?? `server:${Bun.randomUUIDv7()}`
          );
          const context = {
            onBehalf: dispatchOptions.onBehalf === true,
            byTask: dispatchOptions.byTask ?? null,
            guest: dispatchOptions.guest ?? null,
          };
          return yield* Semaphore.withPermit(
            queue,
            apply(command, identity, dispatchOptions.id !== undefined, context)
          );
        });

        const writeBriefing = Effect.fn('Engine.writeBriefing')(function* (
          projectId: string | null,
          written: WrittenBriefing
        ) {
          yield* assertOpen;
          yield* Semaphore.withPermit(
            queue,
            Effect.gen(function* () {
              const briefing = { ...written, at: yield* Clock.currentTimeMillis };
              yield* briefings.write(projectId, briefing);
              const previous = yield* Ref.get(state);
              yield* Ref.set(state, replaceBriefing(previous, projectId, briefing));
              yield* notify({ previous, changes: { briefings: [briefingKey(projectId)] } });
            })
          );
        });

        const reportRetry = Effect.fnUntraced(function* (
          stored: StoredEffect,
          failure: EffectFailure,
          delay: number
        ) {
          const retryAt = (yield* Clock.currentTimeMillis) + delay;
          yield* Effect.logWarning('[Engine] Effect failed, retrying').pipe(
            Effect.annotateLogs({
              kind: stored.effect.kind,
              attempt: stored.attempts,
              retryAt,
              error: failure.message,
            })
          );
          const { retry } = yield* Ref.get(handlers);
          yield* retry(
            stored.effect,
            { attempt: stored.attempts, attempts: MAX_EFFECT_ATTEMPTS, retryAt, failure },
            stored.key
          ).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning('[Engine] Could not report an effect retry').pipe(
                Effect.annotateLogs({ kind: stored.effect.kind, error: describeError(Cause.squash(cause)) })
              )
            )
          );
          yield* outbox.retry(stored.id, retryAt, failure.message);
        });

        const recordFailure = Effect.fnUntraced(function* (stored: StoredEffect, failure: EffectFailure) {
          const delay = yield* resolveEffectRetryDelay(stored.attempts, {
            failure,
            processBound: PROCESS_BOUND_EFFECTS.has(stored.effect.kind),
          });
          if (Option.isSome(delay)) return yield* reportRetry(stored, failure, delay.value);
          yield* Effect.logError('[Engine] Effect failed for good').pipe(
            Effect.annotateLogs({ kind: stored.effect.kind, error: failure.message })
          );
          if (!(yield* outbox.fail(stored.id, yield* Clock.currentTimeMillis, failure.message))) return;
          const { exhausted } = yield* Ref.get(handlers);
          yield* exhausted(stored.effect, failure.message, stored.key).pipe(
            Effect.catchCause((cause) =>
              Effect.logError('[Engine] Could not report a failed effect').pipe(
                Effect.annotateLogs({ error: describeError(Cause.squash(cause)) })
              )
            )
          );
        });

        const execute = Effect.fnUntraced(function* (stored: StoredEffect) {
          const { apply: handle } = yield* Ref.get(handlers);
          const outcome = yield* handle(stored.effect, { key: stored.key, attempt: stored.attempts }).pipe(
            Effect.catchDefect((defect) => Effect.fail(resolveEffectFailure(defect))),
            Effect.result
          );
          if (!(yield* Ref.get(started))) return;
          if (outcome._tag === 'Success') yield* outbox.settle(stored.id, yield* Clock.currentTimeMillis);
          else yield* recordFailure(stored, outcome.failure);
        });

        const pumpOnce = Effect.gen(function* () {
          const claimed = yield* outbox.claim(yield* Clock.currentTimeMillis);
          for (const stored of claimed) {
            yield* FiberMap.run(
              running,
              stored.id,
              execute(stored).pipe(Effect.ensuring(Queue.offer(wake, undefined))),
              { startImmediately: false }
            );
          }
          const next = yield* outbox.selectNextAvailableAt;
          const now = yield* Clock.currentTimeMillis;
          return Option.match(next, {
            onNone: () => IDLE_POLL,
            onSome: (at) =>
              Duration.clamp(Duration.millis(Math.max(0, at - now)), {
                minimum: PUMP_FLOOR,
                maximum: IDLE_POLL,
              }),
          });
        });

        const pump = Effect.gen(function* () {
          const delay = yield* pumpOnce;
          yield* Effect.raceFirst(Queue.take(wake), Effect.sleep(delay));
        }).pipe(Effect.forever);

        const start = Effect.gen(function* () {
          yield* scheduleSnapshot(1);
          const reconciled = yield* commands.reconcile(yield* Clock.currentTimeMillis);
          if (reconciled.requeued + reconciled.cancelled.length + reconciled.failed > 0) {
            yield* Effect.logInfo('[Engine] Recovered the effect outbox after a restart').pipe(
              Effect.annotateLogs({
                requeued: reconciled.requeued,
                cancelled: reconciled.cancelled.length,
                failed: reconciled.failed,
              })
            );
          }
          yield* Ref.set(started, true);
          yield* FiberMap.run(pumping, 'pump', pump);
        });

        const stop = Effect.gen(function* () {
          yield* Ref.set(started, false);
          yield* Ref.set(stopped, true);
          yield* writeSnapshot;
          yield* FiberMap.clear(pumping);
          yield* FiberMap.clear(running);
        });

        const settle = Semaphore.withPermit(queue, Effect.void).pipe(
          Effect.andThen(FiberMap.awaitEmpty(running))
        );

        return EngineCore.of({
          readOnly,
          problems,
          state: Ref.get(state),
          updates: Stream.fromPubSub(updates),
          observe: (listener) =>
            Effect.acquireRelease(
              Effect.sync(() => listeners.add(listener)),
              () => Effect.sync(() => listeners.delete(listener))
            ).pipe(Effect.asVoid),
          dispatch,
          writeBriefing,
          hasReceipt: (id) => receipts.select(id).pipe(Effect.map(Option.isSome)),
          writeSnapshot,
          replaceHandlers: (replaced) => Ref.update(handlers, (current) => ({ ...current, ...replaced })),
          start,
          stop,
          settle,
        });
      })
    );
  }
}
