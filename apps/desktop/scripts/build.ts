import { resolve } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Console, Effect } from 'effect';
import { bundle as runBundle } from '../../../scripts/kit/bundle.ts';
import { reportScriptFailure } from './kit/report.ts';
import { ScriptStepFailed } from './kit/schema.ts';

const desktopDir = resolve(import.meta.dirname, '..');

const BUNDLES = [
  { entry: 'src/main/index.ts', name: 'main.cjs', target: 'node' },
  { entry: 'src/preload/index.ts', name: 'preload.cjs', target: 'browser' },
] as const;

const bundle = Effect.fn('DesktopBuild.bundle')(function* ({
  entry,
  name,
  target,
}: (typeof BUNDLES)[number]) {
  const failed = (logs: string) => new ScriptStepFailed({ message: `Could not bundle ${entry}:\n${logs}` });
  const result = yield* Effect.tryPromise({
    try: () =>
      runBundle({
        entrypoints: [resolve(desktopDir, entry)],
        outdir: resolve(desktopDir, 'dist'),
        naming: name,
        target,
        format: 'cjs',
        external: ['electron'],
      }),
    catch: (error) => failed(String(error)),
  });
  if (!result.success) return yield* failed(result.logs.map(String).join('\n'));
});

Effect.gen(function* () {
  for (const each of BUNDLES) yield* bundle(each);
  yield* Console.log(`Shinsa for Mac in ${resolve(desktopDir, 'dist')}`);
}).pipe(reportScriptFailure, BunRuntime.runMain({ disableErrorReporting: true }));
