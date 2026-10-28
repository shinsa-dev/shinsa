import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAppFlavor } from '@shinsa/core';
import { resolveStateVersion } from '../src/store/snapshot.ts';

const engineDir = resolve(import.meta.dirname, '..');
const outDir = resolve(engineDir, 'dist/engine');
const webDist = resolve(engineDir, '../web/dist');
const version = Bun.env.SHINSA_VERSION?.replace(/^v/, '') || '0.0.0';
const target = Bun.env.SHINSA_ENGINE_TARGET || 'bun-darwin-arm64';
const flavor = parseAppFlavor(Bun.env.SHINSA_FLAVOR || 'stable');
if (!flavor) throw new Error(`SHINSA_FLAVOR must be stable or canary, not "${Bun.env.SHINSA_FLAVOR}".`);

function readCommit() {
  const result = Bun.spawnSync(['git', 'rev-parse', 'HEAD'], { cwd: engineDir });
  const commit = result.stdout.toString().trim();
  return result.exitCode === 0 && /^[0-9a-f]{40}$/.test(commit) ? commit : '';
}

async function compile(entry: string, name: string, define: Record<string, string>) {
  const result = await Bun.build({
    entrypoints: [entry],
    compile: { target: target as Bun.Build.CompileTarget, outfile: join(outDir, 'bin', name) },
    define,
    minify: false,
    sourcemap: 'none',
  });
  if (!result.success) {
    throw new Error(`Could not compile ${name}:\n${result.logs.map(String).join('\n')}`);
  }
}

if (!existsSync(join(webDist, 'index.html'))) {
  throw new Error(`Build the web app first (bun run --cwd apps/web build): ${webDist} has no index.html`);
}

const sdkPackage = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))), 'package.json'),
    'utf8'
  )
) as { version: string; claudeCodeVersion: string };

const stateVersion = resolveStateVersion();
if (!stateVersion) throw new Error('Could not read the state version from @shinsa/core');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(join(outDir, 'bin'), { recursive: true });

await compile(join(engineDir, 'scripts/engine-main.ts'), 'shinsa', {
  'process.env.SHINSA_BUILD_VERSION': JSON.stringify(version),
  'process.env.SHINSA_BUILD_COMMIT': JSON.stringify(readCommit()),
  'process.env.SHINSA_BUILD_FLAVOR': JSON.stringify(flavor),
  'process.env.SHINSA_BUILD_STATE_VERSION': JSON.stringify(stateVersion),
  'process.env.SHINSA_BUILD_SDK_VERSION': JSON.stringify(sdkPackage.version),
  'process.env.SHINSA_BUILD_SDK_CLAUDE_VERSION': JSON.stringify(sdkPackage.claudeCodeVersion),
});

cpSync(resolve(engineDir, 'plugin'), join(outDir, 'plugin'), { recursive: true });
cpSync(webDist, join(outDir, 'web'), { recursive: true });

process.stdout.write(`Shinsa ${version} engine (${flavor}) in ${outDir}\n`);
