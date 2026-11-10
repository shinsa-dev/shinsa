import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseShareMessage } from '@shinsa/core';
import { Effect, FileSystem, Option, Ref } from 'effect';
import { JsonFile } from '../../files/service.ts';
import { describeError } from '../../log/redact.ts';
import { TeamViewFile, TeamViewsIndexFile, VIEW_FILE_MISSING } from '../schema.ts';
import {
  type HeldTeamView,
  INDEX_FILE,
  type TeamViewEntry,
  TeamViewKeepFailed,
  type TeamViewsDefinition,
  type TeamViewsHandle,
} from './schema.ts';

export const makeTeamViews = Effect.fn('TeamViews.make')(function* (definition: TeamViewsDefinition) {
  const json = yield* JsonFile;
  const fs = yield* FileSystem.FileSystem;
  const { dir, limit } = definition;
  const indexPath = join(dir, INDEX_FILE);
  const resolveViewKey = (teamId: string, instanceId: string, taskId: string) =>
    `${teamId} ${instanceId} ${taskId}`;
  const resolveViewPath = (key: string) =>
    join(dir, `${createHash('sha256').update(key).digest('hex')}.json`);
  const removeFile = (path: string, options: { recursive?: boolean } = {}) =>
    fs
      .remove(path, { force: true, ...options })
      .pipe(Effect.mapError((error) => new TeamViewKeepFailed({ message: describeError(error) })));
  const writeFile = (path: string, value: unknown) =>
    json
      .write(path, value)
      .pipe(Effect.mapError((failure) => new TeamViewKeepFailed({ message: failure.message })));

  const index = yield* json.read(indexPath, TeamViewsIndexFile).pipe(
    Effect.map((value) => Option.getOrUndefined(value)?.entries ?? []),
    Effect.catchTag('JsonFileUnreadable', (failure) =>
      Effect.logWarning('[Teams] Could not read the kept team task views').pipe(
        Effect.annotateLogs({ path: indexPath, error: failure.reason }),
        Effect.as<TeamViewEntry[]>([])
      )
    )
  );
  const entries = yield* Ref.make<ReadonlyMap<string, TeamViewEntry>>(
    new Map(index.map((entry) => [resolveViewKey(entry.teamId, entry.instanceId, entry.taskId), entry]))
  );

  const list = Effect.map(Ref.get(entries), (held) => [...held.values()]);

  const selectEntry = (teamId: string, instanceId: string, taskId: string) =>
    Effect.map(Ref.get(entries), (held) => held.get(resolveViewKey(teamId, instanceId, taskId)) ?? null);

  const select = Effect.fn('TeamViews.select')(function* (
    teamId: string,
    instanceId: string,
    taskId: string
  ) {
    const key = resolveViewKey(teamId, instanceId, taskId);
    const entry = (yield* Ref.get(entries)).get(key);
    if (!entry || entry.size === 0) return null;
    const read = yield* json.read(resolveViewPath(key), TeamViewFile).pipe(
      Effect.map((value) => ({ value: Option.getOrNull(value), problem: VIEW_FILE_MISSING })),
      Effect.catchTag('JsonFileUnreadable', (failure) =>
        Effect.succeed({ value: null, problem: failure.reason })
      )
    );
    if (!read.value) {
      yield* Effect.logWarning('[Teams] Could not read a kept team task view').pipe(
        Effect.annotateLogs({ taskId, error: read.problem })
      );
      return null;
    }
    const messages = (read.value.messages ?? []).flatMap((message) =>
      Option.toArray(parseShareMessage(JSON.stringify(message)))
    );
    const held: HeldTeamView | null = messages.length > 0 ? { ...entry, messages } : null;
    return held;
  });

  const saveIndex = Effect.gen(function* () {
    const kept = yield* list;
    if (kept.length === 0) return yield* removeFile(dir, { recursive: true });
    yield* writeFile(indexPath, { version: 1, entries: kept });
  }).pipe(
    Effect.catchTag('TeamViewKeepFailed', (failure) =>
      Effect.logWarning('[Teams] Could not keep the team task views').pipe(
        Effect.annotateLogs({ dir, error: failure.message })
      )
    )
  );

  const evictOver = Effect.fn('TeamViews.evictOver')(function* (kept: string) {
    const held = yield* Ref.get(entries);
    let total = 0;
    for (const entry of held.values()) total += entry.size;
    const oldest = [...held].sort(([, a], [, b]) => a.updatedAt - b.updatedAt);
    for (const [key, entry] of oldest) {
      if (total <= limit) return;
      if (key === kept || entry.size === 0) continue;
      yield* removeFile(resolveViewPath(key));
      total -= entry.size;
      yield* Ref.update(entries, (before) => new Map(before).set(key, { ...entry, size: 0 }));
    }
  });

  const write = Effect.fn('TeamViews.write')(function* (view: HeldTeamView) {
    const key = resolveViewKey(view.teamId, view.instanceId, view.taskId);
    const { messages, ...entry } = view;
    const size = Buffer.byteLength(JSON.stringify(messages));
    yield* Effect.gen(function* () {
      yield* writeFile(resolveViewPath(key), { version: 1, messages });
      yield* Ref.update(entries, (before) => new Map(before).set(key, { ...entry, size }));
      yield* evictOver(key);
      yield* saveIndex;
    }).pipe(
      Effect.catchTag('TeamViewKeepFailed', (failure) =>
        Effect.logWarning('[Teams] Could not keep a team task view').pipe(
          Effect.annotateLogs({ dir, error: failure.message })
        )
      )
    );
  });

  const removeWhere = Effect.fn('TeamViews.removeWhere')(function* (
    matches: (entry: TeamViewEntry) => boolean
  ) {
    const removed = yield* Ref.modify(entries, (before) => {
      const gone = [...before].filter(([, entry]) => matches(entry)).map(([key]) => key);
      const next = new Map(before);
      for (const key of gone) next.delete(key);
      return [gone, next] as const;
    });
    if (removed.length === 0) return;
    yield* Effect.forEach(removed, (key) => removeFile(resolveViewPath(key)).pipe(Effect.ignore), {
      discard: true,
    });
    yield* saveIndex;
  });

  const handle: TeamViewsHandle = { list, selectEntry, select, write, removeWhere };
  return handle;
});
