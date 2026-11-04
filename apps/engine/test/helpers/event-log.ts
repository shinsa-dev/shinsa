import type { ShinsaEvent, StoredBriefing } from '@shinsa/core';
import { Effect, Exit, Layer, Option, Scope } from 'effect';
import { Briefings } from '../../src/store/briefings/service.ts';
import type { CommandCommit } from '../../src/store/commands/schema.ts';
import { CommandLog } from '../../src/store/commands/service.ts';
import { Events } from '../../src/store/events/service.ts';
import { StoreLayer } from '../../src/store/layers.ts';
import { LOG_MIGRATIONS } from '../../src/store/migrations/list.ts';
import type { LogMigration } from '../../src/store/migrations/schema.ts';
import { LogMigrator } from '../../src/store/migrations/service.ts';
import { Outbox } from '../../src/store/outbox/service.ts';
import type { CommandReceipt } from '../../src/store/receipts/schema.ts';
import { Receipts } from '../../src/store/receipts/service.ts';
import type { LogServices } from '../../src/store/schema.ts';
import type { StateSnapshot } from '../../src/store/snapshot/schema.ts';
import { Snapshots } from '../../src/store/snapshot/service.ts';

export type TestEventLog = ReturnType<typeof openEventLog>;

export function openEventLog(path = ':memory:') {
  const scope = Effect.runSync(Scope.make());
  const context = Effect.runSync(Layer.buildWithScope(StoreLayer(path), scope));
  const run = <A, E>(effect: Effect.Effect<A, E, LogServices>) =>
    Effect.runSync(Effect.provideContext(effect, context));
  return {
    context,
    run,
    migrate: (migrations: readonly LogMigration[] = LOG_MIGRATIONS) =>
      run(LogMigrator.use((migrator) => migrator.migrate(migrations))),
    assertCurrent: (migrations: readonly LogMigration[] = LOG_MIGRATIONS) =>
      run(LogMigrator.use((migrator) => migrator.assertCurrent(migrations))),
    readEvents: (after = 0) => run(Events.use((events) => events.read(after))),
    listEventsBetween: (firstSeq: number, lastSeq: number): ShinsaEvent[] =>
      run(Events.use((events) => events.listBetween(firstSeq, lastSeq))),
    writeSnapshot: (snapshot: StateSnapshot, at: number) =>
      run(Snapshots.use((snapshots) => snapshots.write(snapshot, at))),
    selectSnapshot: (version: string) =>
      Option.getOrNull(run(Snapshots.use((snapshots) => snapshots.select(version)))),
    listBriefings: () => run(Briefings.use((briefings) => briefings.list)),
    writeBriefing: (projectId: string | null, stored: StoredBriefing) =>
      run(Briefings.use((briefings) => briefings.write(projectId, stored))),
    commitCommand: (input: CommandCommit) => run(CommandLog.use((log) => log.commit(input))),
    recordReceipt: (receipt: CommandReceipt) => run(Receipts.use((receipts) => receipts.record(receipt))),
    selectReceipt: (id: string) => Option.getOrNull(run(Receipts.use((receipts) => receipts.select(id)))),
    claimEffects: (now: number) => run(Outbox.use((outbox) => outbox.claim(now))),
    settleEffect: (id: number, now: number) => run(Outbox.use((outbox) => outbox.settle(id, now))),
    retryEffect: (id: number, availableAt: number, error: string) =>
      run(Outbox.use((outbox) => outbox.retry(id, availableAt, error))),
    failEffect: (id: number, now: number, error: string) =>
      run(Outbox.use((outbox) => outbox.fail(id, now, error))),
    selectEffectStatus: (key: string) =>
      Option.getOrNull(run(Outbox.use((outbox) => outbox.selectStatus(key)))),
    selectNextAvailableAt: () => Option.getOrNull(run(Outbox.use((outbox) => outbox.selectNextAvailableAt))),
    listEffectStatuses: () => run(Outbox.use((outbox) => outbox.listStatuses)),
    reconcileAfterRestart: (now: number) => run(CommandLog.use((log) => log.reconcile(now))),
    close: () => Effect.runSync(Scope.close(scope, Exit.void)),
  };
}
