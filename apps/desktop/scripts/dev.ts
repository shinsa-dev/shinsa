import { resolve } from 'node:path';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, FileSystem, Option, Schema } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import electronBinary from 'electron';
import { listPlistEdits, resolveDevBundle, serializeDevBundleStamp } from '../src/app/dev-bundle.ts';
import { reportScriptFailure } from './kit/report.ts';
import { runScriptCommand } from './kit/run.ts';
import { ScriptStepFailed } from './kit/schema.ts';

const desktopDir = resolve(import.meta.dirname, '..');

const appIcon = resolve(desktopDir, 'resources', 'icon.icns');

const decodeElectronManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.String }))
);

const writeDevBundle = Effect.fn('DesktopDev.writeDevBundle')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = resolveDevBundle({ electronBinary: electronBinary as unknown as string, desktopDir });
  const iconSize = (yield* fs.exists(appIcon)) ? Number((yield* fs.stat(appIcon)).size) : null;
  const manifest = yield* decodeElectronManifest(
    yield* fs.readFileString(resolve(desktopDir, 'node_modules', 'electron', 'package.json'))
  );
  const stamp = serializeDevBundleStamp(manifest.version, iconSize);
  const stored = yield* fs.readFileString(paths.stamp).pipe(Effect.option);
  if (Option.contains(stored, stamp)) return paths.binary;
  yield* fs.remove(paths.bundle, { recursive: true, force: true });
  yield* runScriptCommand(['ditto', paths.source, paths.bundle]);
  for (const [first, ...rest] of listPlistEdits(paths.plist))
    yield* runScriptCommand(['plutil', first ?? '', ...rest]);
  if (iconSize !== null) yield* fs.copyFile(appIcon, paths.icon);
  yield* runScriptCommand(['codesign', '--force', '--deep', '--sign', '-', paths.bundle]);
  yield* fs.writeFileString(paths.stamp, stamp);
  return paths.binary;
});

Effect.gen(function* () {
  const binary = yield* writeDevBundle().pipe(
    Effect.catchTags({
      PlatformError: (error) => Effect.fail(new ScriptStepFailed({ message: error.message })),
      SchemaError: (error) => Effect.fail(new ScriptStepFailed({ message: error.message })),
    })
  );
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const code = yield* spawner
    .exitCode(
      ChildProcess.make(binary, [desktopDir, ...process.argv.slice(2)], {
        cwd: desktopDir,
        stdin: 'inherit',
        stdout: 'inherit',
        stderr: 'inherit',
      })
    )
    .pipe(Effect.mapError((error) => new ScriptStepFailed({ message: error.message })));
  return yield* Effect.sync(() => process.exit(code));
}).pipe(
  reportScriptFailure,
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
