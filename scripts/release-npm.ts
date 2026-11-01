import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  assertEngineFolder,
  PUBLISHED_ENGINE_TARGETS,
  type PublishedEngineTarget,
  resolveEngineArchive,
} from './release-engine.ts';
import type { ReleaseChannel } from './release-version.ts';

export const LAUNCHER_PACKAGE = 'shinsa';

const LAUNCHER_SOURCE = resolve(import.meta.dirname, '../apps/engine/npm/shinsa.js');
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

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export type RunCommand = (argv: string[]) => CommandResult;

interface EnginePlatform {
  os: string;
  cpu: string;
  libc?: string;
}

export function resolveDistTag(channel: string): string {
  const tags: Record<ReleaseChannel, string> = { stable: 'latest', beta: 'beta', canary: 'canary' };
  const tag = tags[channel as ReleaseChannel];
  if (!tag) throw new Error(`Unknown release channel ${channel}: use stable, beta or canary`);
  return tag;
}

export function resolveEnginePlatform(target: PublishedEngineTarget): EnginePlatform {
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

export function serializeLauncherReadme() {
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

export function assertArchiveChecksum(archive: string, checksumFile: string) {
  const [expected = '', name] = readFileSync(checksumFile, 'utf8').trim().split(/\s+/);
  if (!SHA256_PATTERN.test(expected)) throw new Error(`${checksumFile} holds no SHA-256`);
  if (name !== archive.split('/').at(-1)) throw new Error(`${checksumFile} names ${name}, not ${archive}`);
  const actual = new Bun.CryptoHasher('sha256').update(readFileSync(archive)).digest('hex');
  if (actual !== expected) throw new Error(`${archive} does not match its checksum`);
}

function writeManifest(dir: string, manifest: object) {
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

export function writeNpmPackages(archivesDir: string, outDir: string, version: string): NpmPackage[] {
  rmSync(outDir, { recursive: true, force: true });
  const engines = PUBLISHED_ENGINE_TARGETS.map((target) => {
    const names = resolveEngineArchive(target);
    const archive = join(archivesDir, names.archive);
    if (!existsSync(archive)) throw new Error(`${archive} is missing: the release has no ${names.archive}`);
    assertArchiveChecksum(archive, join(archivesDir, names.checksum));
    const dir = join(outDir, names.folder);
    mkdirSync(dir, { recursive: true });
    const tar = Bun.spawnSync(['tar', '-xzf', archive, '-C', dir, '--strip-components=1'], {
      stderr: 'pipe',
    });
    if (tar.exitCode !== 0) throw new Error(`Could not unpack ${archive}: ${tar.stderr.toString().trim()}`);
    assertEngineFolder(dir);
    writeManifest(dir, createEngineManifest(target, version));
    return { name: resolveEnginePackageName(target), dir };
  });
  const launcher = join(outDir, LAUNCHER_PACKAGE);
  mkdirSync(join(launcher, 'bin'), { recursive: true });
  copyFileSync(LAUNCHER_SOURCE, join(launcher, 'bin/shinsa.js'));
  chmodSync(join(launcher, 'bin/shinsa.js'), 0o755);
  writeFileSync(join(launcher, 'README.md'), serializeLauncherReadme());
  writeManifest(launcher, createLauncherManifest(version));
  return [...engines, { name: LAUNCHER_PACKAGE, dir: launcher }];
}

export function isPublished(name: string, version: string, run: RunCommand) {
  const result = run(['npm', 'view', `${name}@${version}`, 'version']);
  return result.exitCode === 0 && result.stdout.trim() === version;
}

export function publishNpmPackages(
  packages: NpmPackage[],
  { version, tag, dryRun, run }: { version: string; tag: string; dryRun: boolean; run: RunCommand }
) {
  return packages.map(({ name, dir }) => {
    if (!dryRun && isPublished(name, version, run)) return `${name}@${version} is already on npm`;
    const argv = [
      'npm',
      'publish',
      dir,
      '--access',
      'public',
      '--tag',
      tag,
      ...(dryRun ? ['--dry-run'] : []),
    ];
    const result = run(argv);
    if (result.exitCode !== 0) {
      throw new Error(
        `npm publish of ${name}@${version} failed (${result.exitCode}): ${result.stderr.trim()}`
      );
    }
    return `Published ${name}@${version} as ${tag}${dryRun ? ' (dry run)' : ''}`;
  });
}

export function runCommand(argv: string[]): CommandResult {
  const result = Bun.spawnSync(argv, { stdout: 'pipe', stderr: 'pipe' });
  return { exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

export function runReleaseNpm(argv: string[], env: Record<string, string | undefined>, run: RunCommand) {
  const dryRun = argv.includes('--dry-run');
  const [archivesDir, outDir] = argv.filter((arg) => arg !== '--dry-run');
  const version = env.SHINSA_VERSION?.replace(/^v/, '');
  if (!archivesDir || !outDir || !version || !env.RELEASE_CHANNEL) {
    throw new Error(
      'Usage: SHINSA_VERSION=<version> RELEASE_CHANNEL=<channel> bun scripts/release-npm.ts <archives dir> <out dir> [--dry-run]'
    );
  }
  const tag = resolveDistTag(env.RELEASE_CHANNEL);
  const packages = writeNpmPackages(archivesDir, outDir, version);
  return `${publishNpmPackages(packages, { version, tag, dryRun, run }).join('\n')}\n`;
}

if (import.meta.main) process.stdout.write(runReleaseNpm(Bun.argv.slice(2), Bun.env, runCommand));
