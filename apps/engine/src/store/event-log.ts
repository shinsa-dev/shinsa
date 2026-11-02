import type { ShinsaEvent, StoredBriefing } from '@shinsa/core';
import { Effect, ManagedRuntime, Option } from 'effect';
import { Briefings } from './briefings/service.ts';
import type { CommandCommit } from './commands/schema.ts';
import { CommandLog } from './commands/service.ts';
import { Events } from './events/service.ts';
import { StoreLayer } from './layers.ts';
import { LOG_MIGRATIONS } from './migrations/list.ts';
import type { LogMigration } from './migrations/schema.ts';
import { LogMigrator } from './migrations/service.ts';
import { Outbox } from './outbox/service.ts';
import type { CommandReceipt } from './receipts/schema.ts';
import { Receipts } from './receipts/service.ts';
import type { StateSnapshot } from './snapshot/schema.ts';
import { Snapshots } from './snapshot/service.ts';

export type LogServices = Events | Outbox | Receipts | Briefings | Snapshots | LogMigrator | CommandLog;

export class EventLog {
  readonly #runtime: ManagedRuntime.ManagedRuntime<LogServices, never>;

  constructor(path: string) {
    this.#runtime = ManagedRuntime.make(StoreLayer(path));
    this.#runtime.runSync(Effect.void);
  }

  get context() {
    return this.#runtime.runSync(Effect.context<LogServices>());
  }

  migrate(migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
    return this.#runtime.runSync(LogMigrator.use((migrator) => migrator.migrate(migrations)));
  }

  assertCurrent(migrations: readonly LogMigration[] = LOG_MIGRATIONS) {
    this.#runtime.runSync(LogMigrator.use((migrator) => migrator.assertCurrent(migrations)));
  }

  readEvents(after = 0) {
    return this.#runtime.runSync(Events.use((events) => events.read(after)));
  }

  listEventsBetween(firstSeq: number, lastSeq: number): ShinsaEvent[] {
    return this.#runtime.runSync(Events.use((events) => events.listBetween(firstSeq, lastSeq)));
  }

  writeSnapshot(snapshot: StateSnapshot, at: number) {
    return this.#runtime.runSync(Snapshots.use((snapshots) => snapshots.write(snapshot, at)));
  }

  selectSnapshot(version: string) {
    return Option.getOrNull(this.#runtime.runSync(Snapshots.use((snapshots) => snapshots.select(version))));
  }

  listBriefings() {
    return this.#runtime.runSync(Briefings.use((briefings) => briefings.list));
  }

  writeBriefing(projectId: string | null, stored: StoredBriefing) {
    this.#runtime.runSync(Briefings.use((briefings) => briefings.write(projectId, stored)));
  }

  commitCommand(input: CommandCommit) {
    return this.#runtime.runSync(CommandLog.use((log) => log.commit(input)));
  }

  recordReceipt(receipt: CommandReceipt) {
    this.#runtime.runSync(Receipts.use((receipts) => receipts.record(receipt)));
  }

  selectReceipt(id: string) {
    return Option.getOrNull(this.#runtime.runSync(Receipts.use((receipts) => receipts.select(id))));
  }

  claimEffects(now: number) {
    return this.#runtime.runSync(Outbox.use((outbox) => outbox.claim(now)));
  }

  settleEffect(id: number, now: number) {
    return this.#runtime.runSync(Outbox.use((outbox) => outbox.settle(id, now)));
  }

  retryEffect(id: number, availableAt: number, error: string) {
    return this.#runtime.runSync(Outbox.use((outbox) => outbox.retry(id, availableAt, error)));
  }

  failEffect(id: number, now: number, error: string) {
    return this.#runtime.runSync(Outbox.use((outbox) => outbox.fail(id, now, error)));
  }

  selectEffectStatus(key: string) {
    return Option.getOrNull(this.#runtime.runSync(Outbox.use((outbox) => outbox.selectStatus(key))));
  }

  selectNextAvailableAt() {
    return Option.getOrNull(this.#runtime.runSync(Outbox.use((outbox) => outbox.selectNextAvailableAt)));
  }

  listEffectStatuses() {
    return this.#runtime.runSync(Outbox.use((outbox) => outbox.listStatuses));
  }

  reconcileAfterRestart(now: number) {
    return this.#runtime.runSync(CommandLog.use((log) => log.reconcile(now)));
  }

  close() {
    Effect.runSync(this.#runtime.disposeEffect);
  }
}
