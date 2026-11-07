import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Console, Effect, FileSystem, Layer, Schema } from 'effect';
import { resolveBuildChangelog } from '../../../scripts/changelog-history.ts';
import { bundle } from '../../../scripts/kit/bundle.ts';
import { Command, CommandLayer } from '../../../scripts/kit/command/index.ts';
import { reportFailure } from '../../../scripts/kit/script.ts';
import { resolveBuildFolder, resolveBuildTarget } from '../src/instance/targets.ts';
import { resolveStateVersion } from '../src/store/snapshot/version.ts';
import { COMMIT_PATTERN, EngineBuildFailed, SdkPackage } from './schema.ts';

const engineDir = resolve(import.meta.dirname, '..');
const target = resolveBuildTarget(Bun.env.SHINSA_ENGINE_TARGET);
const outDir = resolve(engineDir, 'dist', resolveBuildFolder(target));
const webDist = resolve(engineDir, '../web/dist');
const version = Bun.env.SHINSA_VERSION?.replace(/^v/, '') || '0.0.0';
const decodeSdkPackage = Schema.decodeUnknownEffect(Schema.fromJsonString(SdkPackage));

const readCommit = Effect.fn('EngineBuild.readCommit')(function* () {
  const result = yield* (yield* Command).run(['git', 'rev-parse', 'HEAD'], { cwd: engineDir });
  const commit = result.stdout.trim();
  return result.code === 0 && COMMIT_PATTERN.test(commit) ? commit : '';
});

const readSdkPackage = Effect.fn('EngineBuild.readSdkPackage')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const sdkEntry = fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'));
  const text = yield* fs.readFileString(join(dirname(sdkEntry), 'package.json'));
  return yield* decodeSdkPackage(text).pipe(
    Effect.mapError(() => new EngineBuildFailed({ message: 'Could not read the Claude Agent SDK version' }))
  );
});

const compile = Effect.fn('EngineBuild.compile')(function* (
  entry: string,
  name: string,
  define: Record<string, string>
) {
  const failed = (logs: string) => new EngineBuildFailed({ message: `Could not compile ${name}:\n${logs}` });
  const result = yield* Effect.tryPromise({
    try: () =>
      bundle({
        entrypoints: [entry],
        compile: { target, outfile: join(outDir, 'bin', name) },
        define,
        minify: false,
        sourcemap: 'none',
      }),
    catch: (error) => failed(String(error)),
  });
  if (!result.success) return yield* failed(result.logs.map(String).join('\n'));
});

Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  if (!(yield* fs.exists(join(webDist, 'index.html'))))
    return yield* new EngineBuildFailed({
      message: `Build the web app first (bun run --cwd apps/web build): ${webDist} has no index.html`,
    });
  const sdkPackage = yield* readSdkPackage();
  const stateVersion = yield* resolveStateVersion();
  if (!stateVersion)
    return yield* new EngineBuildFailed({ message: 'Could not read the state version from @shinsa/core' });
  const changelog = yield* resolveBuildChangelog(resolve(engineDir, '../..'), version);

  yield* fs.remove(outDir, { recursive: true, force: true });
  yield* fs.makeDirectory(join(outDir, 'bin'), { recursive: true });

  yield* compile(join(engineDir, 'scripts/engine-main.ts'), 'shinsa', {
    'process.env.SHINSA_BUILD_VERSION': JSON.stringify(version),
    'process.env.SHINSA_BUILD_COMMIT': JSON.stringify(yield* readCommit()),
    'process.env.SHINSA_BUILD_STATE_VERSION': JSON.stringify(stateVersion),
    'process.env.SHINSA_BUILD_SDK_VERSION': JSON.stringify(sdkPackage.version),
    'process.env.SHINSA_BUILD_SDK_CLAUDE_VERSION': JSON.stringify(sdkPackage.claudeCodeVersion),
    'process.env.SHINSA_BUILD_CHANGELOG': JSON.stringify(JSON.stringify(changelog)),
  });

  yield* fs.copy(resolve(engineDir, 'plugin'), join(outDir, 'plugin'), { overwrite: true });
  yield* fs.copy(webDist, join(outDir, 'web'), { overwrite: true });

  yield* Console.log(`Shinsa ${version} engine for ${target} in ${outDir}`);
}).pipe(
  reportFailure,
  Effect.provide(Layer.mergeAll(CommandLayer, BunServices.layer)),
  BunRuntime.runMain({ disableErrorReporting: true })
);
