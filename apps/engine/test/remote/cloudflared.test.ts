import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { FetchHttpClient } from 'effect/http';
import { resolveCloudflaredAsset, resolveCloudflaredPath } from '../../src/remote/cloudflared/asset.ts';
import {
  CLOUDFLARED_VERSION,
  type CloudflaredAsset,
  CloudflaredTarget,
} from '../../src/remote/cloudflared/schema.ts';
import { Cloudflared } from '../../src/remote/cloudflared/service.ts';
import { runCommand } from '../../src/shell/index.ts';
import { CommandNotFound } from '../../src/shell/schema.ts';
import { Shell } from '../../src/shell/service.ts';
import { createTempDir } from '../helpers/index.ts';

function sha256(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex');
}

function serve(bytes: Uint8Array, status = 200) {
  const urls: string[] = [];
  const fetch = (input: string | URL | Request) => {
    urls.push(input instanceof Request ? input.url : String(input));
    return Promise.resolve(new Response(bytes, { status }));
  };
  return { fetch: fetch as typeof globalThis.fetch, urls };
}

function install(
  dataDir: string,
  asset: CloudflaredAsset | null,
  fetch?: typeof globalThis.fetch,
  shell: Layer.Layer<Shell> = Shell.layer.pipe(Layer.provide(BunServices.layer))
) {
  return Effect.runPromise(
    Cloudflared.use((cloudflared) => cloudflared.install).pipe(
      Effect.provide(
        Cloudflared.layer.pipe(
          Layer.provide(Layer.succeed(CloudflaredTarget, { dataDir, asset })),
          Layer.provide(Layer.mergeAll(FetchHttpClient.layer, shell)),
          Layer.provide(fetch ? Layer.succeed(FetchHttpClient.Fetch, fetch) : Layer.empty),
          Layer.provide(BunServices.layer)
        )
      )
    )
  );
}

function refuse(...input: Parameters<typeof install>) {
  return install(...input).then(
    () => null,
    (error: unknown) => error
  );
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
    const path = await install(dataDir, asset, server.fetch);
    expect(path).toBe(resolveCloudflaredPath(dataDir, asset));
    expect(statSync(path).mode & 0o111).not.toBe(0);
    expect(await install(dataDir, asset, server.fetch)).toBe(path);
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
    const path = await install(dataDir, asset, serve(bytes).fetch);
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
    expect(await refuse(dataDir, asset, serve(new Uint8Array([1])).fetch)).toMatchObject({
      _tag: 'CloudflaredInstallFailed',
      message: expect.stringContaining('checksum'),
    });
    expect(existsSync(resolveCloudflaredPath(dataDir, asset))).toBe(false);
    expect(await refuse(dataDir, asset, serve(new Uint8Array(), 404).fetch)).toMatchObject({
      message: expect.stringContaining('status 404'),
    });
    const unreachable = (() => Promise.reject(new Error('offline'))) as unknown as typeof globalThis.fetch;
    expect(await refuse(dataDir, asset, unreachable)).toMatchObject({
      message: 'Could not download cloudflared.',
    });
    const empty = await createArchive({ other: 'x' });
    expect(
      await refuse(dataDir, { ...asset, sha256: sha256(empty), archive: true }, serve(empty).fetch)
    ).toMatchObject({ message: expect.stringContaining('did not contain') });
    const broken = new Uint8Array([1, 2, 3]);
    expect(
      await refuse(dataDir, { ...asset, sha256: sha256(broken), archive: true }, serve(broken).fetch)
    ).toMatchObject({ message: expect.stringContaining('Could not unpack') });
    const noTar = Layer.succeed(Shell, {
      run: () => Effect.fail(new CommandNotFound({ command: 'tar', message: 'tar is not installed.' })),
      stopTree: () => Effect.void,
    });
    expect(
      await refuse(dataDir, { ...asset, sha256: sha256(broken), archive: true }, serve(broken).fetch, noTar)
    ).toMatchObject({ message: 'Could not unpack cloudflared: tar is not installed.' });
    const notADir = join(createTempDir(), 'file');
    writeFileSync(notADir, '');
    const bytes = new Uint8Array([4]);
    expect(await refuse(notADir, { ...asset, sha256: sha256(bytes) }, serve(bytes).fetch)).toMatchObject({
      message: expect.stringContaining('Could not prepare data/bin'),
    });
    expect(await refuse(dataDir, null)).toMatchObject({
      _tag: 'CloudflaredUnsupported',
      message: expect.stringContaining('no build for this computer'),
    });
  });
});
