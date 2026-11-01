#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { dirname, join } = require('node:path');

const ENGINE_PACKAGES = {
  'darwin-arm64': '@shinsa/darwin-arm64',
  'linux-x64': '@shinsa/linux-x64',
  'linux-arm64': '@shinsa/linux-arm64',
};

const SUPPORTED = 'Shinsa’s engine runs on Apple Silicon Macs and on Linux x64 and arm64 with glibc.';

function resolveEnginePackage(platform, arch) {
  const name = ENGINE_PACKAGES[`${platform}-${arch}`];
  if (name) return name;
  if (platform === 'darwin') {
    throw new Error(`${SUPPORTED} This Mac has an Intel processor, so there is no engine for it.`);
  }
  throw new Error(`${SUPPORTED} There is no engine for ${platform} ${arch}.`);
}

function resolveEngineBinary(platform, arch, resolve) {
  const name = resolveEnginePackage(platform, arch);
  let manifest;
  try {
    manifest = resolve(`${name}/package.json`);
  } catch {
    throw new Error(
      `${name} is not installed. Install shinsa again without --omit=optional or --no-optional. ${SUPPORTED}`
    );
  }
  return join(dirname(manifest), 'bin', 'shinsa');
}

function runLauncher({ platform, arch, argv, resolve, spawn, writeError }) {
  let binary;
  try {
    binary = resolveEngineBinary(platform, arch, resolve);
  } catch (error) {
    writeError(`${error.message}\n`);
    return 1;
  }
  const result = spawn(binary, argv, { stdio: 'inherit' });
  if (result.error) {
    writeError(`Could not run ${binary}: ${result.error.message}\n`);
    return 1;
  }
  if (result.signal) return 128 + (require('node:os').constants.signals[result.signal] ?? 0);
  return result.status ?? 1;
}

if (require.main === module) {
  process.exitCode = runLauncher({
    platform: process.platform,
    arch: process.arch,
    argv: process.argv.slice(2),
    resolve: require.resolve,
    spawn: spawnSync,
    writeError: (text) => process.stderr.write(text),
  });
}

module.exports = { ENGINE_PACKAGES, resolveEnginePackage, resolveEngineBinary, runLauncher };
