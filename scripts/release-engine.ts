import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PUBLISHED_ENGINE_TARGETS = ['bun-darwin-arm64', 'bun-linux-x64', 'bun-linux-arm64'] as const;

export type PublishedEngineTarget = (typeof PUBLISHED_ENGINE_TARGETS)[number];

export interface EngineArchive {
  folder: string;
  archive: string;
  checksum: string;
}

export interface PackOptions {
  target: string;
  folder: string;
  outDir: string;
  version: string;
}

const ENGINE_CONTENTS = ['bin/shinsa', 'plugin', 'web/index.html'];

export function resolvePublishedTarget(requested: string): PublishedEngineTarget {
  const target = PUBLISHED_ENGINE_TARGETS.find((known) => known === requested);
  if (!target) {
    throw new Error(`Unknown engine target ${requested}: use one of ${PUBLISHED_ENGINE_TARGETS.join(', ')}`);
  }
  return target;
}

export function resolveEngineArchive(target: PublishedEngineTarget): EngineArchive {
  const folder = `shinsa-${target.replace(/^bun-/, '')}`;
  return { folder, archive: `${folder}.tar.gz`, checksum: `${folder}.tar.gz.sha256` };
}

export function serializeChecksum(sha256: string, name: string) {
  return `${sha256}  ${name}\n`;
}

export function assertEngineFolder(folder: string) {
  const missing = ENGINE_CONTENTS.filter((entry) => !existsSync(join(folder, entry)));
  if (missing.length > 0) {
    throw new Error(`${folder} is not a built engine: it has no ${missing.join(', ')}`);
  }
  if ((statSync(join(folder, 'bin/shinsa')).mode & 0o111) === 0) {
    throw new Error(`${join(folder, 'bin/shinsa')} is not executable`);
  }
}

export function assertEngineVersion(binary: string, version: string) {
  const result = Bun.spawnSync([binary, 'version', '--json'], { stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`${binary} version failed (${result.exitCode}): ${result.stderr.toString().trim()}`);
  }
  const reported = (JSON.parse(result.stdout.toString()) as { command?: { version?: string } }).command
    ?.version;
  if (reported !== version) {
    throw new Error(`The engine reports version ${reported ?? 'none'}, but the release is ${version}`);
  }
}

export async function packEngine({ target, folder, outDir, version }: PackOptions) {
  const names = resolveEngineArchive(resolvePublishedTarget(target));
  assertEngineFolder(folder);
  assertEngineVersion(join(folder, 'bin/shinsa'), version);
  const staging = mkdtempSync(join(tmpdir(), 'shinsa-pack-'));
  try {
    cpSync(folder, join(staging, names.folder), { recursive: true });
    mkdirSync(outDir, { recursive: true });
    const archive = join(outDir, names.archive);
    const tar = Bun.spawnSync(['tar', '-czf', archive, '-C', staging, names.folder], {
      env: { ...Bun.env, COPYFILE_DISABLE: '1' },
      stderr: 'pipe',
    });
    if (tar.exitCode !== 0) {
      throw new Error(`Could not pack ${names.archive}: ${tar.stderr.toString().trim()}`);
    }
    const sha256 = new Bun.CryptoHasher('sha256').update(await Bun.file(archive).arrayBuffer()).digest('hex');
    writeFileSync(join(outDir, names.checksum), serializeChecksum(sha256, names.archive));
    return { ...names, sha256 };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export async function runPackEngine(argv: string[], env: Record<string, string | undefined>) {
  const [target, folder, outDir] = argv;
  const version = env.SHINSA_VERSION?.replace(/^v/, '');
  if (!target || !folder || !outDir || !version) {
    throw new Error(
      'Usage: SHINSA_VERSION=<version> bun scripts/release-engine.ts <target> <engine folder> <out dir>'
    );
  }
  const packed = await packEngine({ target, folder, outDir, version });
  return `Packed Shinsa ${version} for ${target} as ${packed.archive} (sha256 ${packed.sha256})\n`;
}

if (import.meta.main) process.stdout.write(await runPackEngine(Bun.argv.slice(2), Bun.env));
