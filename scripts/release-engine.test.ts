import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertEngineFolder,
  PUBLISHED_ENGINE_TARGETS,
  packEngine,
  resolveEngineArchive,
  resolvePublishedTarget,
  runPackEngine,
  serializeChecksum,
} from './release-engine.ts';

const made: string[] = [];

function createDir() {
  const dir = mkdtempSync(join(tmpdir(), 'shinsa-release-engine-'));
  made.push(dir);
  return dir;
}

function createEngine(version: string, script?: string) {
  const folder = createDir();
  mkdirSync(join(folder, 'bin'));
  mkdirSync(join(folder, 'plugin/skills'), { recursive: true });
  mkdirSync(join(folder, 'web/assets'), { recursive: true });
  writeFileSync(join(folder, 'plugin/skills/review.md'), '# Review\n');
  writeFileSync(join(folder, 'web/index.html'), '<!doctype html>\n');
  writeFileSync(
    join(folder, 'bin/shinsa'),
    script ?? `#!/bin/sh\nprintf '%s' '{"command":{"version":"${version}"}}'\n`
  );
  chmodSync(join(folder, 'bin/shinsa'), 0o755);
  return folder;
}

function listArchive(archive: string) {
  const result = Bun.spawnSync(['tar', '-tzf', archive]);
  return result.stdout
    .toString()
    .split('\n')
    .filter(Boolean)
    .map((entry) => entry.replace(/\/$/, ''));
}

afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('engine archive names', () => {
  it('names one archive and one checksum per published target', () => {
    expect(PUBLISHED_ENGINE_TARGETS.map((target) => resolveEngineArchive(target))).toEqual([
      {
        folder: 'shinsa-darwin-arm64',
        archive: 'shinsa-darwin-arm64.tar.gz',
        checksum: 'shinsa-darwin-arm64.tar.gz.sha256',
      },
      {
        folder: 'shinsa-linux-x64',
        archive: 'shinsa-linux-x64.tar.gz',
        checksum: 'shinsa-linux-x64.tar.gz.sha256',
      },
      {
        folder: 'shinsa-linux-arm64',
        archive: 'shinsa-linux-arm64.tar.gz',
        checksum: 'shinsa-linux-arm64.tar.gz.sha256',
      },
    ]);
  });

  it('refuses a target that is not published', () => {
    expect(resolvePublishedTarget('bun-linux-arm64')).toBe('bun-linux-arm64');
    expect(() => resolvePublishedTarget('bun-darwin-x64')).toThrow(
      'Unknown engine target bun-darwin-x64: use one of bun-darwin-arm64, bun-linux-x64, bun-linux-arm64'
    );
  });

  it('writes the checksum the way sha256sum and shasum read it', () => {
    expect(serializeChecksum('a'.repeat(64), 'shinsa-linux-x64.tar.gz')).toBe(
      `${'a'.repeat(64)}  shinsa-linux-x64.tar.gz\n`
    );
  });
});

describe('packing an engine', () => {
  it('tars the binary, the plugin and the web app under one folder, with its checksum', async () => {
    const outDir = join(createDir(), 'out');
    const packed = await packEngine({
      target: 'bun-linux-x64',
      folder: createEngine('1.2.0'),
      outDir,
      version: '1.2.0',
    });

    const archive = join(outDir, 'shinsa-linux-x64.tar.gz');
    expect(packed.archive).toBe('shinsa-linux-x64.tar.gz');
    expect(listArchive(archive)).toEqual(
      expect.arrayContaining([
        'shinsa-linux-x64/bin/shinsa',
        'shinsa-linux-x64/plugin/skills/review.md',
        'shinsa-linux-x64/web/index.html',
      ])
    );
    expect(listArchive(archive).every((entry) => entry.startsWith('shinsa-linux-x64'))).toBe(true);

    const sha256 = new Bun.CryptoHasher('sha256').update(readFileSync(archive)).digest('hex');
    expect(packed.sha256).toBe(sha256);
    expect(readFileSync(join(outDir, 'shinsa-linux-x64.tar.gz.sha256'), 'utf8')).toBe(
      `${sha256}  shinsa-linux-x64.tar.gz\n`
    );
    const check = Bun.spawnSync(['shasum', '-a', '256', '-c', 'shinsa-linux-x64.tar.gz.sha256'], {
      cwd: outDir,
    });
    expect(check.exitCode).toBe(0);
  });

  it('keeps the binary executable inside the archive', async () => {
    const outDir = createDir();
    await packEngine({ target: 'bun-darwin-arm64', folder: createEngine('2.0.0'), outDir, version: '2.0.0' });
    const unpacked = createDir();
    Bun.spawnSync(['tar', '-xzf', join(outDir, 'shinsa-darwin-arm64.tar.gz'), '-C', unpacked]);
    const run = Bun.spawnSync([join(unpacked, 'shinsa-darwin-arm64/bin/shinsa'), 'version', '--json']);
    expect(JSON.parse(run.stdout.toString())).toEqual({ command: { version: '2.0.0' } });
  });

  it('refuses an engine whose version is not the release', async () => {
    const outDir = createDir();
    await expect(
      packEngine({ target: 'bun-linux-arm64', folder: createEngine('1.1.0'), outDir, version: '1.2.0' })
    ).rejects.toThrow('The engine reports version 1.1.0, but the release is 1.2.0');
    expect(existsSync(join(outDir, 'shinsa-linux-arm64.tar.gz'))).toBe(false);
  });

  it('refuses an engine that reports no version or cannot run', async () => {
    const silent = createEngine('', "#!/bin/sh\nprintf '{}'\n");
    await expect(
      packEngine({ target: 'bun-linux-x64', folder: silent, outDir: createDir(), version: '1.2.0' })
    ).rejects.toThrow('The engine reports version none, but the release is 1.2.0');

    const broken = createEngine('', '#!/bin/sh\necho "cannot start" >&2\nexit 3\n');
    await expect(
      packEngine({ target: 'bun-linux-x64', folder: broken, outDir: createDir(), version: '1.2.0' })
    ).rejects.toThrow('version failed (3): cannot start');
  });

  it('says why it cannot write the archive', async () => {
    const outDir = createDir();
    mkdirSync(join(outDir, 'shinsa-linux-x64.tar.gz'));
    await expect(
      packEngine({ target: 'bun-linux-x64', folder: createEngine('1.2.0'), outDir, version: '1.2.0' })
    ).rejects.toThrow('Could not pack shinsa-linux-x64.tar.gz');
  });
});

describe('checking the engine folder', () => {
  it('names what a built engine is missing', () => {
    const folder = createEngine('1.0.0');
    rmSync(join(folder, 'web'), { recursive: true });
    rmSync(join(folder, 'plugin'), { recursive: true });
    expect(() => assertEngineFolder(folder)).toThrow(
      `${folder} is not a built engine: it has no plugin, web/index.html`
    );
  });

  it('refuses a binary that cannot run', () => {
    const folder = createEngine('1.0.0');
    chmodSync(join(folder, 'bin/shinsa'), 0o644);
    expect(() => assertEngineFolder(folder)).toThrow(`${join(folder, 'bin/shinsa')} is not executable`);
  });
});

describe('the command line', () => {
  it('packs from the arguments and the release version', async () => {
    const outDir = createDir();
    const line = await runPackEngine(['bun-linux-x64', createEngine('1.3.0'), outDir], {
      SHINSA_VERSION: 'v1.3.0',
    });
    expect(line).toStartWith('Packed Shinsa 1.3.0 for bun-linux-x64 as shinsa-linux-x64.tar.gz (sha256 ');
    expect(existsSync(join(outDir, 'shinsa-linux-x64.tar.gz.sha256'))).toBe(true);
  });

  it('says how to call it when something is missing', async () => {
    await expect(runPackEngine(['bun-linux-x64'], { SHINSA_VERSION: '1.3.0' })).rejects.toThrow('Usage: ');
    await expect(runPackEngine(['bun-linux-x64', 'engine', 'out'], {})).rejects.toThrow('Usage: ');
  });
});
