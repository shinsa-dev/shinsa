import { resolve } from 'node:path';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, FileSystem } from 'effect';
import { bundle as runBundle } from '../../../scripts/kit/bundle.ts';
import { readMarkPaths } from './kit/marks.ts';
import { inlinePageScript } from './kit/page.ts';
import { reportScriptFailure } from './kit/report.ts';
import { ScriptStepFailed } from './kit/schema.ts';

const desktopDir = resolve(import.meta.dirname, '..');

const distDir = resolve(desktopDir, 'dist');

const BUNDLES = [
  { entry: 'src/main/index.ts', name: 'main.cjs', target: 'node', format: 'cjs' },
  { entry: 'src/preload/index.ts', name: 'preload.cjs', target: 'browser', format: 'cjs' },
  { entry: 'src/welcome-page/index.ts', name: 'welcome.js', target: 'browser', format: 'iife' },
] as const;

const WELCOME = {
  template: 'static/welcome.html',
  script: 'welcome.js',
  page: 'welcome.html',
  logo: '../../packages/ui/src/components/logo.tsx',
  font: '../../packages/ui/src/styles/fonts/ABCArealVariable.woff2',
} as const;

const bundle = Effect.fn('DesktopBuild.bundle')(function* ({
  entry,
  name,
  target,
  format,
}: (typeof BUNDLES)[number]) {
  const failed = (logs: string) => new ScriptStepFailed({ message: `Could not bundle ${entry}:\n${logs}` });
  const result = yield* Effect.tryPromise({
    try: () =>
      runBundle({
        entrypoints: [resolve(desktopDir, entry)],
        outdir: distDir,
        naming: name,
        target,
        format,
        minify: format === 'iife',
        external: ['electron'],
      }),
    catch: (error) => failed(String(error)),
  });
  if (!result.success) return yield* failed(result.logs.map(String).join('\n'));
});

const writeWelcomePage = Effect.fn('DesktopBuild.writeWelcomePage')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const template = yield* fs.readFileString(resolve(desktopDir, WELCOME.template));
  const script = yield* fs.readFileString(resolve(distDir, WELCOME.script));
  const marks = yield* readMarkPaths(resolve(desktopDir, WELCOME.logo));
  const font = Buffer.from(yield* fs.readFile(resolve(desktopDir, WELCOME.font))).toString('base64');
  yield* fs.writeFileString(
    resolve(distDir, WELCOME.page),
    inlinePageScript(template, { script, marks, font })
  );
  yield* fs.remove(resolve(distDir, WELCOME.script));
});

Effect.gen(function* () {
  for (const each of BUNDLES) yield* bundle(each);
  yield* writeWelcomePage();
  yield* Console.log(`Shinsa for Mac in ${distDir}`);
}).pipe(
  reportScriptFailure,
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
