import { join } from 'node:path';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Clock, Console, Effect, FileSystem } from 'effect';
import { Briefings } from '../../apps/engine/src/store/briefings/service.ts';
import { CommandLog } from '../../apps/engine/src/store/commands/service.ts';
import { StoreLayer } from '../../apps/engine/src/store/layers.ts';
import { reportFailure } from '../kit/script.ts';
import { buildSyntheticLog, serializeSyntheticTranscript } from './synthetic/log.ts';
import { DEFAULT_SYNTHETIC_DIR, LARGE, type SyntheticOptions } from './synthetic/schema.ts';

export const writeSyntheticData = Effect.fn('Synthetic.write')(function* (
  dataDir: string,
  options: SyntheticOptions = LARGE
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(dataDir, { recursive: true, force: true });
  const transcripts = join(dataDir, 'transcripts');
  yield* fs.makeDirectory(transcripts, { recursive: true });
  const log = buildSyntheticLog(options);
  yield* Effect.gen(function* () {
    const commands = yield* CommandLog;
    const briefings = yield* Briefings;
    for (const commit of log.commits) yield* commands.commit(commit);
    for (const briefing of log.briefings) yield* briefings.write(null, briefing);
  }).pipe(Effect.provide(StoreLayer(join(dataDir, 'shinsa.sqlite'))));
  for (const [index, runId] of log.runIds.entries()) {
    const entries =
      index < options.longTranscripts ? options.longTranscriptEntries : options.shortTranscriptEntries;
    yield* fs.writeFileString(
      join(transcripts, `${runId}.jsonl`),
      serializeSyntheticTranscript(runId, entries)
    );
  }
  return { events: log.events, tasks: log.tasks, runs: log.runIds.length, longRunIds: log.longRunIds };
});

if (import.meta.main) {
  Effect.gen(function* () {
    const dir = Bun.argv[2] ?? DEFAULT_SYNTHETIC_DIR;
    const started = yield* Clock.currentTimeMillis;
    const written = yield* writeSyntheticData(dir);
    const ms = (yield* Clock.currentTimeMillis) - started;
    yield* Console.log(JSON.stringify({ dir, ...written, longRunIds: written.longRunIds.length, ms }));
  }).pipe(
    reportFailure,
    Effect.provide(BunServices.layer),
    BunRuntime.runMain({ disableErrorReporting: true })
  );
}
