import { join, resolve } from 'node:path';
import { Config, Console, Duration, Effect, FileSystem, Schema } from 'effect';
import { Command } from '../kit/command/index.ts';
import { isOnGitHubActions, retryStep, serializeRetryWarning } from '../release-retry.ts';
import type { ReleaseChannel } from '../release-version.ts';
import {
  assertEngineFolder,
  PUBLISHED_ENGINE_TARGETS,
  type PublishedEngineTarget,
  resolveEngineArchive,
} from './engine.ts';
import {
  ArchiveInvalid,
  NpmPublishFailed,
  ReleaseRefused,
  type RetryFailure,
  ScriptUsage,
} from './schema.ts';

const LAUNCHER_PACKAGE = 'shinsa';

export const NPM_PUBLISH_DELAYS = [Duration.seconds(30), Duration.minutes(1)];

const LAUNCHER_SOURCE = resolve(import.meta.dirname, '../../apps/engine/npm/shinsa.js');
const REPOSITORY = { type: 'git', url: 'git+https://github.com/shinsa-dev/shinsa.git' };
const SHARED_FIELDS = {
  license: 'AGPL-3.0-only',
  homepage: 'https://shinsa.dev',
  repository: REPOSITORY,
};
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface NpmPackage {
  name: string;
  dir: string;
}

interface EnginePlatform {
  os: string;
  cpu: string;
  libc?: string;
}

const DIST_TAGS: Record<ReleaseChannel, string> = { stable: 'latest', beta: 'beta', canary: 'canary' };

const decodeChannel = Schema.decodeUnknownEffect(Schema.Literals(['stable', 'beta', 'canary']));

export const resolveDistTag = Effect.fn('resolveDistTag')(function* (channel: string) {
  const known = yield* decodeChannel(channel).pipe(
    Effect.mapError(
      () => new ReleaseRefused({ message: `Unknown release channel ${channel}: use stable, beta or canary` })
    )
  );
  return DIST_TAGS[known];
});

function resolveEnginePlatform(target: PublishedEngineTarget): EnginePlatform {
  const [os = '', cpu = ''] = target.replace(/^bun-/, '').split('-');
  return os === 'linux' ? { os, cpu, libc: 'glibc' } : { os, cpu };
}

export function resolveEnginePackageName(target: PublishedEngineTarget) {
  return `@shinsa/${target.replace(/^bun-/, '')}`;
}

export function createEngineManifest(target: PublishedEngineTarget, version: string) {
  const platform = resolveEnginePlatform(target);
  return {
    name: resolveEnginePackageName(target),
    version,
    description: `The Shinsa engine for ${platform.os} ${platform.cpu}. Install shinsa rather than this package.`,
    ...SHARED_FIELDS,
    os: [platform.os],
    cpu: [platform.cpu],
    ...(platform.libc ? { libc: [platform.libc] } : {}),
    files: ['bin', 'plugin', 'web'],
  };
}

export function createLauncherManifest(version: string) {
  return {
    name: LAUNCHER_PACKAGE,
    version,
    description:
      'Shinsa’s engine and the `shinsa` command: hand coding work to agents and keep the decisions.',
    ...SHARED_FIELDS,
    bin: { shinsa: 'bin/shinsa.js' },
    files: ['bin'],
    engines: { node: '>=18' },
    optionalDependencies: Object.fromEntries(
      PUBLISHED_ENGINE_TARGETS.map((target) => [resolveEnginePackageName(target), version])
    ),
  };
}

function serializeLauncherReadme() {
  return [
    '# Shinsa',
    '',
    'The Shinsa engine and the `shinsa` command, for Linux (x64 and arm64, glibc) and Apple Silicon Macs.',
    'It includes the web app, served on the engine’s port.',
    '',
    '```sh',
    'npm i -g shinsa',
    'shinsa start',
    '```',
    '',
    'On a Mac you can install the Shinsa app instead, which carries the same engine: https://shinsa.dev',
    '',
  ].join('\n');
}

export const assertArchiveChecksum = Effect.fn('assertArchiveChecksum')(function* (
  archive: string,
  checksumFile: string
) {
  const fs = yield* FileSystem.FileSystem;
  const unreadable = (error: { readonly message: string }) =>
    new ArchiveInvalid({ message: `Could not read ${archive} or its checksum: ${error.message}` });
  const [expected = '', name] = (yield* fs.readFileString(checksumFile).pipe(Effect.mapError(unreadable)))
    .trim()
    .split(/\s+/);
  if (!SHA256_PATTERN.test(expected))
    return yield* new ArchiveInvalid({ message: `${checksumFile} holds no SHA-256` });
  if (name !== archive.split('/').at(-1))
    return yield* new ArchiveInvalid({ message: `${checksumFile} names ${name}, not ${archive}` });
  const bytes = yield* fs.readFile(archive).pipe(Effect.mapError(unreadable));
  const actual = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  if (actual !== expected)
    return yield* new ArchiveInvalid({ message: `${archive} does not match its checksum` });
});

export const writeNpmPackages = Effect.fn('writeNpmPackages')(function* (
  archivesDir: string,
  outDir: string,
  version: string
) {
  const command = yield* Command;
  const fs = yield* FileSystem.FileSystem;
  const unwritable = (error: { readonly message: string }) =>
    new ArchiveInvalid({ message: `Could not write the npm packages in ${outDir}: ${error.message}` });
  const writeManifest = (dir: string, manifest: object) =>
    fs
      .writeFileString(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      .pipe(Effect.mapError(unwritable));
  const writeEngine = Effect.fn('writeNpmPackages.engine')(function* (target: PublishedEngineTarget) {
    const names = resolveEngineArchive(target);
    const archive = join(archivesDir, names.archive);
    if (!(yield* fs.exists(archive).pipe(Effect.mapError(unwritable))))
      return yield* new ArchiveInvalid({
        message: `${archive} is missing: the release has no ${names.archive}`,
      });
    yield* assertArchiveChecksum(archive, join(archivesDir, names.checksum));
    const dir = join(outDir, names.folder);
    yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(unwritable));
    const tar = yield* command.run(['tar', '-xzf', archive, '-C', dir, '--strip-components=1']);
    if (tar.code !== 0)
      return yield* new ArchiveInvalid({ message: `Could not unpack ${archive}: ${tar.stderr}` });
    yield* assertEngineFolder(dir);
    yield* writeManifest(dir, createEngineManifest(target, version));
    const written: NpmPackage = { name: resolveEnginePackageName(target), dir };
    return written;
  });

  yield* fs.remove(outDir, { recursive: true, force: true }).pipe(Effect.mapError(unwritable));
  const engines = yield* Effect.forEach(PUBLISHED_ENGINE_TARGETS, writeEngine);
  const launcher = join(outDir, LAUNCHER_PACKAGE);
  const bin = join(launcher, 'bin/shinsa.js');
  yield* Effect.all([
    fs.makeDirectory(join(launcher, 'bin'), { recursive: true }),
    fs.copyFile(LAUNCHER_SOURCE, bin),
    fs.chmod(bin, 0o755),
    fs.writeFileString(join(launcher, 'README.md'), serializeLauncherReadme()),
  ]).pipe(Effect.mapError(unwritable));
  yield* writeManifest(launcher, createLauncherManifest(version));
  const packages: NpmPackage[] = [...engines, { name: LAUNCHER_PACKAGE, dir: launcher }];
  return packages;
});

export const isPublished = Effect.fn('isPublished')(function* (name: string, version: string) {
  const command = yield* Command;
  const result = yield* command.run(['npm', 'view', `${name}@${version}`, 'version']);
  return result.code === 0 && result.stdout.trim() === version;
});

export function summarizeNpmError(stderr: string) {
  const errors = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('npm error'));
  return errors.length > 0 ? errors.join(' ') : stderr.trim();
}

export const warnPublishRetry = Effect.fn('warnPublishRetry')(function* (failure: RetryFailure) {
  const onGitHubActions = yield* Effect.orDie(isOnGitHubActions);
  yield* Console.error(serializeRetryWarning(failure, onGitHubActions).trimEnd());
});

export interface PublishOptions {
  readonly version: string;
  readonly tag: string;
  readonly dryRun: boolean;
  readonly onRetry: (failure: RetryFailure) => Effect.Effect<void>;
}

export const publishNpmPackages = Effect.fn('publishNpmPackages')(function* (
  packages: readonly NpmPackage[],
  { version, tag, dryRun, onRetry }: PublishOptions
) {
  const command = yield* Command;
  const publish = Effect.fn('publishNpmPackages.publish')(function* ({ name, dir }: NpmPackage) {
    if (!dryRun && (yield* isPublished(name, version))) return `${name}@${version} is already on npm`;
    const argv = [
      'npm',
      'publish',
      dir,
      '--access',
      'public',
      '--tag',
      tag,
      ...(dryRun ? ['--dry-run'] : []),
    ] as const;
    const result = yield* command.run(argv);
    if (result.code !== 0)
      return yield* new NpmPublishFailed({
        message: `npm publish of ${name}@${version} failed (${result.code}): ${summarizeNpmError(result.stderr)}`,
      });
    return `Published ${name}@${version} as ${tag}${dryRun ? ' (dry run)' : ''}`;
  });
  return yield* Effect.forEach(packages, (entry) =>
    publish(entry).pipe(
      retryStep({
        label: `Publish ${entry.name}@${version}`,
        delays: dryRun ? [] : NPM_PUBLISH_DELAYS,
        onRetry,
      })
    )
  );
});

export const runReleaseNpm = Effect.fn('runReleaseNpm')(function* (
  argv: readonly string[],
  onRetry: PublishOptions['onRetry'] = warnPublishRetry
) {
  const dryRun = argv.includes('--dry-run');
  const [archivesDir, outDir] = argv.filter((arg) => arg !== '--dry-run');
  const settings = yield* Effect.orDie(
    Config.all({
      version: Config.String('SHINSA_VERSION').pipe(Config.withDefault('')),
      channel: Config.String('RELEASE_CHANNEL').pipe(Config.withDefault('')),
    })
  );
  const version = settings.version.replace(/^v/, '');
  if (!archivesDir || !outDir || !version || !settings.channel)
    return yield* new ScriptUsage({
      message:
        'Usage: SHINSA_VERSION=<version> RELEASE_CHANNEL=<channel> bun scripts/release-npm.ts <archives dir> <out dir> [--dry-run]',
    });
  const tag = yield* resolveDistTag(settings.channel);
  const packages = yield* writeNpmPackages(archivesDir, resolve(outDir), version);
  return (yield* publishNpmPackages(packages, { version, tag, dryRun, onRetry })).join('\n');
});
