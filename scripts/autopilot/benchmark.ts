import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect } from 'effect';
import { resolveShinsaPaths } from '../../apps/engine/src/config/paths.ts';
import { reportFailure } from '../kit/script.ts';
import { replayAutopilotLog } from './replay.ts';
import { serializeBenchmark } from './report.ts';

const program = Effect.gen(function* () {
  const dataDir = Bun.argv[2] ?? resolveShinsaPaths(process.env).dataDir;
  const replay = yield* replayAutopilotLog(dataDir);
  yield* Console.log(serializeBenchmark(replay));
});

program.pipe(Effect.scoped, reportFailure, Effect.provide(BunServices.layer), BunRuntime.runMain);
