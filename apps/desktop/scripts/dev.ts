import { copyFileSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import electronBinary from 'electron';
import { listPlistEdits, resolveDevBundle, serializeDevBundleStamp } from '../src/lib/dev-bundle.ts';

const desktopDir = resolve(import.meta.dirname, '..');

const appIcon = resolve(desktopDir, 'resources', 'icon.icns');

function run(command: string[]) {
  const result = Bun.spawnSync(command, { stdout: 'ignore', stderr: 'pipe' });
  if (result.exitCode !== 0) throw new Error(`${command.join(' ')} failed: ${result.stderr.toString()}`);
}

function readElectronVersion() {
  const manifest = resolve(desktopDir, 'node_modules', 'electron', 'package.json');
  return (JSON.parse(readFileSync(manifest, 'utf8')) as { version: string }).version;
}

function writeDevBundle() {
  const paths = resolveDevBundle({ electronBinary: electronBinary as unknown as string, desktopDir });
  const iconSize = existsSync(appIcon) ? statSync(appIcon).size : null;
  const stamp = serializeDevBundleStamp(readElectronVersion(), iconSize);
  if (existsSync(paths.stamp) && readFileSync(paths.stamp, 'utf8') === stamp) return paths.binary;
  rmSync(paths.bundle, { recursive: true, force: true });
  run(['ditto', paths.source, paths.bundle]);
  for (const edit of listPlistEdits(paths.plist)) run(['plutil', ...edit]);
  if (iconSize !== null) copyFileSync(appIcon, paths.icon);
  run(['codesign', '--force', '--deep', '--sign', '-', paths.bundle]);
  writeFileSync(paths.stamp, stamp);
  return paths.binary;
}

const app = Bun.spawn([writeDevBundle(), desktopDir, ...process.argv.slice(2)], {
  cwd: desktopDir,
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(await app.exited);
