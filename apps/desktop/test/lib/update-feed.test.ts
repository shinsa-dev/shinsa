import { describe, expect, it } from 'bun:test';
import { resolveVersionOrder } from '@shinsa/core';
import type { AppUpdater } from 'electron-updater';
import type { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js';
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider.js';
import type { UpdateChannel } from '../../src/lib/bridge.ts';
import { resolveDowngradeOffer, resolveUpdaterOptions, UPDATE_FEED } from '../../src/lib/update-channel.ts';

const ZIP_NAME = 'Shinsa-mac-arm64.zip';

type ChannelFiles = Partial<Record<'latest' | 'beta' | 'canary', string>>;

function writeUpdateFile(version: string) {
  const url = JSON.stringify(`${version}/${ZIP_NAME}`);
  return [
    `version: ${JSON.stringify(version)}`,
    'files:',
    `  - url: ${url}`,
    '    sha512: "c2hpbnNh"',
    '    size: 1',
    `path: ${url}`,
    'sha512: "c2hpbnNh"',
    'releaseDate: "2026-10-01T00:00:00.000Z"',
    '',
  ].join('\n');
}

async function resolveFeedUpdate(channel: UpdateChannel, current: string, files: ChannelFiles) {
  const requested: string[] = [];
  const executor = {
    request: async (request: { hostname: string; path: string }) => {
      requested.push(`${request.hostname}${request.path}`);
      const name = /^\/updates\/(latest|beta|canary)-mac\.yml$/.exec(request.path)?.[1] as
        | keyof ChannelFiles
        | undefined;
      const version = name ? files[name] : undefined;
      if (!version) throw new Error(`No ${request.path}`);
      return writeUpdateFile(version);
    },
  } as unknown as ElectronHttpExecutor;
  const options = resolveUpdaterOptions(channel);
  const updater = { ...options, currentVersion: current, isAddNoCacheQuery: false } as unknown as AppUpdater;
  const runtime = { isUseMultipleRangeRequest: false, platform: 'darwin' as const, executor };
  const provider = new GenericProvider({ ...UPDATE_FEED }, updater, runtime);
  const info = await provider.getLatestVersion();
  const [zip] = provider.resolveFiles(info);
  return {
    version: info.version,
    file: requested.at(-1),
    zip: zip?.url.href,
    offered: resolveVersionOrder(info.version, current) === 1,
  };
}

describe('the shinsa.dev update feed, read by electron-updater as each channel sets it up', () => {
  it('reads one file per channel from shinsa.dev and downloads that version’s own zip', async () => {
    const files = { latest: '3.0.0', beta: '3.1.0-beta.2', canary: '3.1.1-canary.4' };
    expect(await resolveFeedUpdate('stable', '2.9.0', files)).toEqual({
      version: '3.0.0',
      file: 'shinsa.dev/updates/latest-mac.yml',
      zip: `https://shinsa.dev/updates/3.0.0/${ZIP_NAME}`,
      offered: true,
    });
    expect(await resolveFeedUpdate('beta', '3.0.0', files)).toEqual({
      version: '3.1.0-beta.2',
      file: 'shinsa.dev/updates/beta-mac.yml',
      zip: `https://shinsa.dev/updates/3.1.0-beta.2/${ZIP_NAME}`,
      offered: true,
    });
    expect(await resolveFeedUpdate('canary', '3.0.0', files)).toEqual({
      version: '3.1.1-canary.4',
      file: 'shinsa.dev/updates/canary-mac.yml',
      zip: `https://shinsa.dev/updates/3.1.1-canary.4/${ZIP_NAME}`,
      offered: true,
    });
  });

  it('downloads updates one range at a time, since R2 serves a single range per request', () => {
    expect(UPDATE_FEED).toEqual({
      provider: 'generic',
      url: 'https://shinsa.dev/updates',
      useMultipleRangeRequest: false,
    });
  });

  it('offers a newer stable release to a beta on Beta, as a stable release also moves beta-mac.yml', async () => {
    const files = { latest: '4.0.0', beta: '4.0.0' };
    expect((await resolveFeedUpdate('beta', '3.0.1-beta.1', files)).offered).toBe(true);
  });

  it('offers nothing on the version a channel already runs', async () => {
    const files = { latest: '3.0.0', beta: '3.1.0-beta.1', canary: '3.1.1-canary.2' };
    expect((await resolveFeedUpdate('stable', '3.0.0', files)).offered).toBe(false);
    expect((await resolveFeedUpdate('beta', '3.1.0-beta.1', files)).offered).toBe(false);
    expect((await resolveFeedUpdate('canary', '3.1.1-canary.2', files)).offered).toBe(false);
  });

  it('finds a lower stable release for a beta on Stable, which the app offers as going back', async () => {
    const update = await resolveFeedUpdate('stable', '3.0.1-beta.1', {
      latest: '3.0.0',
      beta: '3.0.1-beta.1',
    });
    expect(update).toMatchObject({ version: '3.0.0', offered: false });
    expect(
      resolveDowngradeOffer({
        channel: 'stable',
        current: '3.0.1-beta.1',
        latest: update.version,
        kept: null,
      })
    ).toBe('3.0.0');
  });

  it('finds a lower beta for a canary on Beta, which the app offers as going back', async () => {
    const update = await resolveFeedUpdate('beta', '3.1.1-canary.2', { beta: '3.1.0-beta.1' });
    expect(update).toMatchObject({ version: '3.1.0-beta.1', offered: false });
    expect(
      resolveDowngradeOffer({
        channel: 'beta',
        current: '3.1.1-canary.2',
        latest: update.version,
        kept: null,
      })
    ).toBe('3.1.0-beta.1');
  });
});
