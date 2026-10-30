import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand } from '../shell/index.ts';

export const CLOUDFLARED_VERSION = '2026.10.6';

export interface CloudflaredAsset {
  version: string;
  url: string;
  sha256: string;
  archive: boolean;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const RELEASES = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}`;

const PINNED: Record<string, { file: string; sha256: string }> = {
  'darwin-arm64': {
    file: 'cloudflared-darwin-arm64.tgz',
    sha256: 'ea1e5105d35bbe16cee5b2f7b4742059ada341fbd35938ed827c24b85efa51c8',
  },
  'darwin-x64': {
    file: 'cloudflared-darwin-amd64.tgz',
    sha256: '6c04a13835ca5ff29a0c6f58d17d1f3956aad1b7df1631f5b5efbc06269deded',
  },
  'linux-arm64': {
    file: 'cloudflared-linux-arm64',
    sha256: '0ae0e179475b2c77651a718d2b376e0151f4fca5954702a84f02843a4d5fcac0',
  },
  'linux-x64': {
    file: 'cloudflared-linux-amd64',
    sha256: '1d356dac769d0dbf62ebe588c4034824bbff98d5790c2f844cc99e0e2f57462d',
  },
};

const DOWNLOAD_TIMEOUT_MS = 120_000;

export function resolveCloudflaredAsset(platform: string, arch: string): CloudflaredAsset | null {
  const pinned = PINNED[`${platform}-${arch}`];
  if (!pinned) return null;
  return {
    version: CLOUDFLARED_VERSION,
    url: `${RELEASES}/${pinned.file}`,
    sha256: pinned.sha256,
    archive: pinned.file.endsWith('.tgz'),
  };
}

export function resolveCloudflaredPath(dataDir: string, asset: CloudflaredAsset) {
  return join(dataDir, 'bin', `cloudflared-${asset.version}`);
}

export interface CloudflaredInstallOptions {
  dataDir: string;
  asset: CloudflaredAsset | null;
  fetch?: Fetch;
}

async function extractArchive(archive: string, dir: string) {
  const result = await runCommand(['tar', '-xzf', archive, '-C', dir], dir, { timeoutMs: 30_000 });
  if (!result.ok) throw new Error(`Could not unpack cloudflared: ${result.stderr.trim()}`);
  const binary = join(dir, 'cloudflared');
  if (!existsSync(binary)) throw new Error('The cloudflared download did not contain the program.');
  return binary;
}

export async function installCloudflared(options: CloudflaredInstallOptions) {
  const { asset } = options;
  if (!asset) throw new Error('Remote access needs cloudflared, which has no build for this computer.');
  const path = resolveCloudflaredPath(options.dataDir, asset);
  if (existsSync(path)) return path;
  const response = await (options.fetch ?? fetch)(asset.url, {
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Could not download cloudflared (status ${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== asset.sha256) throw new Error('The cloudflared download did not match its pinned checksum.');
  mkdirSync(join(options.dataDir, 'bin'), { recursive: true });
  const staging = mkdtempSync(join(options.dataDir, 'bin', '.cloudflared-'));
  try {
    const download = join(staging, 'download');
    writeFileSync(download, bytes);
    let binary = download;
    if (asset.archive) binary = await extractArchive(download, staging);
    chmodSync(binary, 0o755);
    renameSync(binary, path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return path;
}
