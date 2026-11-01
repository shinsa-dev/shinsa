import { afterEach, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PUBLISHED_ENGINE_TARGETS, packEngine } from './release-engine.ts';
import {
  assertArchiveChecksum,
  type CommandResult,
  createEngineManifest,
  createLauncherManifest,
  isPublished,
  publishNpmPackages,
  resolveDistTag,
  resolveEnginePackageName,
  runCommand,
  runReleaseNpm,
  writeNpmPackages,
} from './release-npm.ts';

const launcher = require('../apps/engine/npm/shinsa.js') as {
  ENGINE_PACKAGES: Record<string, string>;
  resolveEnginePackage: (platform: string, arch: string) => string;
  resolveEngineBinary: (platform: string, arch: string, resolve: (id: string) => string) => string;
  runLauncher: (options: {
    platform: string;
    arch: string;
    argv: string[];
    resolve: (id: string) => string;
    spawn: (
      binary: string,
      argv: string[],
      options: object
    ) => {
      status: number | null;
      signal?: string | null;
      error?: Error;
    };
    writeError: (text: string) => void;
  }) => number;
};

const VERSION = '1.2.0-canary.3';
const made: string[] = [];

function createDir() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-release-npm-'));
  made.push(dir);
  return dir;
}

async function createArchives() {
  const archives = createDir();
  for (const target of PUBLISHED_ENGINE_TARGETS) {
    const folder = createDir();
    mkdirSync(join(folder, 'bin'));
    mkdirSync(join(folder, 'plugin'));
    mkdirSync(join(folder, 'web'));
    writeFileSync(join(folder, 'plugin/plugin.json'), '{}\n');
    writeFileSync(join(folder, 'web/index.html'), '<!doctype html>\n');
    writeFileSync(
      join(folder, 'bin/shinsa'),
      `#!/bin/sh\n# ${target}\nprintf '%s' '{"command":{"version":"${VERSION}"}}'\n`
    );
    chmodSync(join(folder, 'bin/shinsa'), 0o755);
    await packEngine({ target, folder, outDir: archives, version: VERSION });
  }
  return archives;
}

function createRunner(answers: (argv: string[]) => Partial<CommandResult> = () => ({})) {
  const calls: string[][] = [];
  const run = (argv: string[]) => {
    calls.push(argv);
    return { exitCode: 0, stdout: '', stderr: '', ...answers(argv) };
  };
  return { calls, run };
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('the dist-tags', () => {
  it('maps stable to latest and keeps beta and canary as they are', () => {
    expect(resolveDistTag('stable')).toBe('latest');
    expect(resolveDistTag('beta')).toBe('beta');
    expect(resolveDistTag('canary')).toBe('canary');
    expect(() => resolveDistTag('nightly')).toThrow('Unknown release channel nightly');
  });
});

describe('the manifests', () => {
  it('names one package per engine, for its own system and CPU, glibc only on Linux', () => {
    expect(PUBLISHED_ENGINE_TARGETS.map(resolveEnginePackageName)).toEqual([
      '@shinsa/darwin-arm64',
      '@shinsa/linux-x64',
      '@shinsa/linux-arm64',
    ]);
    const mac = createEngineManifest('bun-darwin-arm64', VERSION);
    expect(mac).toMatchObject({
      name: '@shinsa/darwin-arm64',
      version: VERSION,
      os: ['darwin'],
      cpu: ['arm64'],
    });
    expect('libc' in mac).toBe(false);
    expect(createEngineManifest('bun-linux-x64', VERSION)).toMatchObject({
      os: ['linux'],
      cpu: ['x64'],
      libc: ['glibc'],
      files: ['bin', 'plugin', 'web'],
    });
  });

  it('makes the launcher depend on every engine at exactly its own version', () => {
    expect(createLauncherManifest(VERSION)).toMatchObject({
      name: 'shinsa',
      version: VERSION,
      bin: { shinsa: 'bin/shinsa.js' },
      optionalDependencies: {
        '@shinsa/darwin-arm64': VERSION,
        '@shinsa/linux-x64': VERSION,
        '@shinsa/linux-arm64': VERSION,
      },
    });
  });

  it('agrees with the launcher on which package carries each engine', () => {
    expect(Object.values(launcher.ENGINE_PACKAGES)).toEqual(
      PUBLISHED_ENGINE_TARGETS.map(resolveEnginePackageName)
    );
  });
});

describe('writing the packages', () => {
  it('unpacks each checked archive into its package and writes the launcher last', async () => {
    const archives = await createArchives();
    const out = createDir();
    const packages = writeNpmPackages(archives, out, VERSION);
    expect(packages.map((entry) => entry.name)).toEqual([
      '@shinsa/darwin-arm64',
      '@shinsa/linux-x64',
      '@shinsa/linux-arm64',
      'shinsa',
    ]);
    const linux = join(out, 'shinsa-linux-x64');
    expect(readFileSync(join(linux, 'bin/shinsa'), 'utf8')).toContain('bun-linux-x64');
    expect(existsSync(join(linux, 'plugin/plugin.json'))).toBe(true);
    expect(existsSync(join(linux, 'web/index.html'))).toBe(true);
    expect(JSON.parse(readFileSync(join(linux, 'package.json'), 'utf8')).name).toBe('@shinsa/linux-x64');
    const bin = join(out, 'shinsa/bin/shinsa.js');
    expect(statSync(bin).mode & 0o111).not.toBe(0);
    expect(readFileSync(join(out, 'shinsa/README.md'), 'utf8')).toContain('npm i -g shinsa');
  });

  it('refuses a missing archive and one that does not match its checksum', async () => {
    const archives = await createArchives();
    rmSync(join(archives, 'shinsa-linux-arm64.tar.gz'));
    expect(() => writeNpmPackages(archives, createDir(), VERSION)).toThrow(
      'the release has no shinsa-linux-arm64'
    );
    const other = await createArchives();
    writeFileSync(join(other, 'shinsa-darwin-arm64.tar.gz'), 'not the archive');
    expect(() => writeNpmPackages(other, createDir(), VERSION)).toThrow('does not match its checksum');
  });

  it('refuses a checksum file with no sum or for another file', async () => {
    const archives = await createArchives();
    const archive = join(archives, 'shinsa-linux-x64.tar.gz');
    const sums = join(archives, 'shinsa-linux-x64.tar.gz.sha256');
    writeFileSync(sums, 'nope  shinsa-linux-x64.tar.gz\n');
    expect(() => assertArchiveChecksum(archive, sums)).toThrow('holds no SHA-256');
    writeFileSync(sums, `${'a'.repeat(64)}  other.tar.gz\n`);
    expect(() => assertArchiveChecksum(archive, sums)).toThrow('names other.tar.gz');
  });

  it('refuses an archive that will not unpack', async () => {
    const archives = await createArchives();
    const archive = join(archives, 'shinsa-darwin-arm64.tar.gz');
    writeFileSync(archive, 'garbage');
    const sum = new Bun.CryptoHasher('sha256').update('garbage').digest('hex');
    writeFileSync(`${archive}.sha256`, `${sum}  shinsa-darwin-arm64.tar.gz\n`);
    expect(() => writeNpmPackages(archives, createDir(), VERSION)).toThrow('Could not unpack');
  });
});

describe('publishing', () => {
  const packages = [
    { name: '@shinsa/linux-x64', dir: '/out/shinsa-linux-x64' },
    { name: 'shinsa', dir: '/out/shinsa' },
  ];

  it('publishes each package in order, public, under the channel’s tag', () => {
    const { calls, run } = createRunner((argv) => (argv[1] === 'view' ? { exitCode: 1 } : {}));
    expect(publishNpmPackages(packages, { version: VERSION, tag: 'canary', dryRun: false, run })).toEqual([
      `Published @shinsa/linux-x64@${VERSION} as canary`,
      `Published shinsa@${VERSION} as canary`,
    ]);
    expect(calls.filter((argv) => argv[1] === 'publish')).toEqual([
      ['npm', 'publish', '/out/shinsa-linux-x64', '--access', 'public', '--tag', 'canary'],
      ['npm', 'publish', '/out/shinsa', '--access', 'public', '--tag', 'canary'],
    ]);
  });

  it('skips a version already on npm, so a rerun finishes the rest', () => {
    const { calls, run } = createRunner((argv) =>
      argv[1] === 'view' && argv[2]?.startsWith('@shinsa/') ? { stdout: `${VERSION}\n` } : { exitCode: 1 }
    );
    expect(() => publishNpmPackages(packages, { version: VERSION, tag: 'beta', dryRun: false, run })).toThrow(
      'npm publish of shinsa'
    );
    expect(calls.filter((argv) => argv[1] === 'publish').map((argv) => argv[2])).toEqual(['/out/shinsa']);
    expect(isPublished('shinsa', VERSION, createRunner(() => ({ stdout: '9.9.9' })).run)).toBe(false);
  });

  it('passes a dry run on to npm without asking what is published', () => {
    const { calls, run } = createRunner();
    expect(publishNpmPackages(packages, { version: VERSION, tag: 'latest', dryRun: true, run })[1]).toBe(
      `Published shinsa@${VERSION} as latest (dry run)`
    );
    expect(calls.every((argv) => argv.at(-1) === '--dry-run')).toBe(true);
  });

  it('runs the whole release from its arguments and environment', async () => {
    const archives = await createArchives();
    const out = createDir();
    const { calls, run } = createRunner((argv) => (argv[1] === 'view' ? { exitCode: 1 } : {}));
    const text = runReleaseNpm(
      [archives, out],
      { SHINSA_VERSION: `v${VERSION}`, RELEASE_CHANNEL: 'stable' },
      run
    );
    expect(text.trim().split('\n')).toHaveLength(4);
    expect(calls.filter((argv) => argv[1] === 'publish').every((argv) => argv.includes('latest'))).toBe(true);
    expect(() =>
      runReleaseNpm([archives], { SHINSA_VERSION: VERSION, RELEASE_CHANNEL: 'beta' }, run)
    ).toThrow('Usage:');
  });

  it('runs a real command and reads its output', () => {
    expect(runCommand(['sh', '-c', 'echo out; echo err >&2; exit 3'])).toEqual({
      exitCode: 3,
      stdout: 'out\n',
      stderr: 'err\n',
    });
  });
});

describe('the launcher', () => {
  const resolve = (id: string) => `/lib/node_modules/${id}`;

  it('picks the engine package for this machine', () => {
    expect(launcher.resolveEnginePackage('linux', 'x64')).toBe('@shinsa/linux-x64');
    expect(launcher.resolveEnginePackage('darwin', 'arm64')).toBe('@shinsa/darwin-arm64');
    expect(launcher.resolveEngineBinary('linux', 'arm64', resolve)).toBe(
      '/lib/node_modules/@shinsa/linux-arm64/bin/shinsa'
    );
  });

  it('refuses an Intel Mac and any other system plainly', () => {
    expect(() => launcher.resolveEnginePackage('darwin', 'x64')).toThrow('This Mac has an Intel processor');
    expect(() => launcher.resolveEnginePackage('win32', 'x64')).toThrow('There is no engine for win32 x64.');
  });

  it('says how to fix a missing engine package', () => {
    const missing = () => {
      throw new Error('Cannot find module');
    };
    expect(() => launcher.resolveEngineBinary('linux', 'x64', missing)).toThrow(
      '@shinsa/linux-x64 is not installed. Install shinsa again without --omit=optional'
    );
  });

  it('runs the engine with the arguments and hands back its exit', () => {
    const errors: string[] = [];
    const seen: unknown[] = [];
    const base = {
      platform: 'linux',
      arch: 'x64',
      argv: ['status'],
      resolve,
      writeError: (t: string) => errors.push(t),
    };
    expect(
      launcher.runLauncher({
        ...base,
        spawn: (binary, argv, options) => {
          seen.push(binary, argv, options);
          return { status: 4 };
        },
      })
    ).toBe(4);
    expect(seen).toEqual([
      '/lib/node_modules/@shinsa/linux-x64/bin/shinsa',
      ['status'],
      { stdio: 'inherit' },
    ]);
    expect(launcher.runLauncher({ ...base, spawn: () => ({ status: null, signal: 'SIGTERM' }) })).toBe(143);
    expect(launcher.runLauncher({ ...base, spawn: () => ({ status: null }) })).toBe(1);
    expect(
      launcher.runLauncher({ ...base, spawn: () => ({ status: null, error: new Error('EACCES') }) })
    ).toBe(1);
    expect(launcher.runLauncher({ ...base, platform: 'darwin', spawn: () => ({ status: 0 }) })).toBe(1);
    expect(errors).toEqual([
      'Could not run /lib/node_modules/@shinsa/linux-x64/bin/shinsa: EACCES\n',
      expect.stringContaining('This Mac has an Intel processor'),
    ]);
  });

  it('runs as a program under Node or Bun and fails clearly without its engine', () => {
    const result = Bun.spawnSync(
      ['bun', join(import.meta.dirname, '../apps/engine/npm/shinsa.js'), 'version'],
      {
        stderr: 'pipe',
      }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toMatch(/is not installed|no engine for/);
  });
});
