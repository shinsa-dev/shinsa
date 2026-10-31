import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOUDFLARED_VERSION,
  type CloudflaredAsset,
  installCloudflared,
  resolveCloudflaredAsset,
  resolveCloudflaredPath,
} from '../../src/remote/cloudflared.ts';
import { runCommand } from '../../src/shell/index.ts';
import { createTempDir } from '../helpers/index.ts';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function serve(bytes: Uint8Array, status = 200) {
  const urls: string[] = [];
  const fetch = (input: string) => {
    urls.push(input);
    return Promise.resolve(new Response(bytes, { status }));
  };
  return { fetch, urls };
}

async function createArchive(contents: Record<string, string>) {
  const dir = createTempDir();
  const source = join(dir, 'source');
  mkdirSync(source);
  for (const [name, text] of Object.entries(contents)) writeFileSync(join(source, name), text);
  const archive = join(dir, 'archive.tgz');
  await runCommand(['tar', '-czf', archive, '-C', source, ...Object.keys(contents)], dir);
  return new Uint8Array(readFileSync(archive));
}

describe('the pinned cloudflared', () => {
  test('pins a release and checksum for macOS and Linux on both architectures', () => {
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'arm64'],
      ['linux', 'x64'],
    ] as const) {
      const asset = resolveCloudflaredAsset(platform, arch);
      expect(asset?.version).toBe(CLOUDFLARED_VERSION);
      expect(asset?.url).toStartWith('https://github.com/cloudflare/cloudflared/releases/download/');
      expect(asset?.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(asset?.archive).toBe(platform === 'darwin');
    }
    expect(resolveCloudflaredAsset('win32', 'x64')).toBeNull();
  });

  test('installs a plain binary once, executable, under data/bin', async () => {
    const dataDir = createTempDir();
    const bytes = new TextEncoder().encode('#!/bin/sh\necho hi\n');
    const asset: CloudflaredAsset = {
      version: 'v1',
      url: 'https://x/bin',
      sha256: sha256(bytes),
      archive: false,
    };
    const server = serve(bytes);
    const path = await installCloudflared({ dataDir, asset, fetch: server.fetch });
    expect(path).toBe(resolveCloudflaredPath(dataDir, asset));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(await installCloudflared({ dataDir, asset, fetch: server.fetch })).toBe(path);
    expect(server.urls).toEqual(['https://x/bin']);
  });

  test('unpacks an archive and takes the cloudflared inside it', async () => {
    const dataDir = createTempDir();
    const bytes = await createArchive({ cloudflared: 'binary' });
    const asset: CloudflaredAsset = {
      version: 'v2',
      url: 'https://x/a.tgz',
      sha256: sha256(bytes),
      archive: true,
    };
    const path = await installCloudflared({ dataDir, asset, fetch: serve(bytes).fetch });
    expect(readFileSync(path, 'utf8')).toBe('binary');
  });

  test('refuses a download that does not match its checksum, fails or has no program inside', async () => {
    const dataDir = createTempDir();
    const asset: CloudflaredAsset = {
      version: 'v3',
      url: 'https://x/b',
      sha256: '0'.repeat(64),
      archive: false,
    };
    await expect(
      installCloudflared({ dataDir, asset, fetch: serve(new Uint8Array([1])).fetch })
    ).rejects.toThrow('checksum');
    expect(existsSync(resolveCloudflaredPath(dataDir, asset))).toBe(false);
    await expect(
      installCloudflared({ dataDir, asset, fetch: serve(new Uint8Array(), 404).fetch })
    ).rejects.toThrow('status 404');
    const empty = await createArchive({ other: 'x' });
    await expect(
      installCloudflared({
        dataDir,
        asset: { ...asset, sha256: sha256(empty), archive: true },
        fetch: serve(empty).fetch,
      })
    ).rejects.toThrow('did not contain');
    const broken = new Uint8Array([1, 2, 3]);
    await expect(
      installCloudflared({
        dataDir,
        asset: { ...asset, sha256: sha256(broken), archive: true },
        fetch: serve(broken).fetch,
      })
    ).rejects.toThrow('Could not unpack');
    await expect(installCloudflared({ dataDir, asset: null })).rejects.toThrow('no build for this computer');
  });
});
