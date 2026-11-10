import { readTeamSnapshot, type TeamTask } from '@shinsa/core';
import { Effect, FileSystem, Option, Ref } from 'effect';
import { JsonFile } from '../../files/service.ts';
import { describeError } from '../../log/redact.ts';
import { TeamSnapshotsFile } from '../schema.ts';
import {
  type HeldTeamList,
  type TeamSnapshotsDefinition,
  type TeamSnapshotsHandle,
  TeamSnapshotsKeepFailed,
} from './schema.ts';

export const makeTeamSnapshots = Effect.fn('TeamSnapshots.make')(function* (
  definition: TeamSnapshotsDefinition
) {
  const json = yield* JsonFile;
  const fs = yield* FileSystem.FileSystem;
  const { path } = definition;
  const resolveListKey = (teamId: string, instanceId: string) => `${teamId} ${instanceId}`;

  const read = json.read(path, TeamSnapshotsFile).pipe(
    Effect.map((value) =>
      (Option.getOrUndefined(value)?.lists ?? []).map(({ tasks, snapshot, ...list }): HeldTeamList => ({
        ...list,
        tasks: tasks as TeamTask[],
        snapshot: Option.getOrNull(readTeamSnapshot(snapshot)),
      }))
    ),
    Effect.catchTag('JsonFileUnreadable', (failure) =>
      Effect.logWarning('[Teams] Could not read the kept team snapshots').pipe(
        Effect.annotateLogs({ path, error: failure.reason }),
        Effect.as<HeldTeamList[]>([])
      )
    )
  );

  const lists = yield* Ref.make<ReadonlyMap<string, HeldTeamList>>(
    new Map((yield* read).map((held) => [resolveListKey(held.teamId, held.instanceId), held]))
  );

  const list = Effect.map(Ref.get(lists), (held) => [...held.values()]);

  const select = (teamId: string, instanceId: string) =>
    Effect.map(Ref.get(lists), (held) => held.get(resolveListKey(teamId, instanceId)) ?? null);

  const save = Effect.gen(function* () {
    const kept = yield* list;
    if (kept.length === 0)
      return yield* fs
        .remove(path, { force: true })
        .pipe(Effect.mapError((error) => new TeamSnapshotsKeepFailed({ message: describeError(error) })));
    yield* json
      .write(path, { version: 1, lists: kept })
      .pipe(Effect.mapError((failure) => new TeamSnapshotsKeepFailed({ message: failure.message })));
  }).pipe(
    Effect.catchTag('TeamSnapshotsKeepFailed', (failure) =>
      Effect.logWarning('[Teams] Could not keep the team snapshots').pipe(
        Effect.annotateLogs({ path, error: failure.message })
      )
    )
  );

  const write = Effect.fn('TeamSnapshots.write')(function* (held: HeldTeamList) {
    yield* Ref.update(lists, (before) =>
      new Map(before).set(resolveListKey(held.teamId, held.instanceId), held)
    );
    yield* save;
  });

  const remove = Effect.fn('TeamSnapshots.remove')(function* (teamId: string, instanceId: string) {
    const key = resolveListKey(teamId, instanceId);
    const removed = yield* Ref.modify(lists, (before) => {
      if (!before.has(key)) return [false, before] as const;
      const next = new Map(before);
      next.delete(key);
      return [true, next] as const;
    });
    if (removed) yield* save;
  });

  const handle: TeamSnapshotsHandle = { list, select, write, remove };
  return handle;
});
