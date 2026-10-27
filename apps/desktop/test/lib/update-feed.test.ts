import { describe, expect, it } from 'bun:test';
import { resolveVersionOrder } from '@shinsa/core';
import type { AppUpdater } from 'electron-updater';
import type { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor.js';
import { GitHubProvider } from 'electron-updater/out/providers/GitHubProvider.js';
import type { UpdateChannel } from '../../src/lib/bridge.ts';
import { resolveDowngradeOffer, resolveUpdaterOptions } from '../../src/lib/update-channel.ts';

const REPO = '/shinsa-dev/shinsa/releases';

interface Release {
  tag: string;
  prerelease: boolean;
}

function writeFeed(releases: readonly Release[]) {
  const entries = releases.map(
    ({ tag }) =>
      `<entry><id>${tag}</id><link rel="alternate" type="text/html" href="https://github.com${REPO}/tag/${tag}"/><title>${tag}</title><content type="html">Notes</content></entry>`
  );
  return `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">${entries.join('')}</feed>`;
}

function writeUpdateFile(tag: string) {
  const version = tag.slice(1);
  return [
    `version: ${version}`,
    'files:',
    '  - url: Shinsa-mac-arm64.zip',
    '    sha512: c2hpbnNh',
    '    size: 1',
    'path: Shinsa-mac-arm64.zip',
    'sha512: c2hpbnNh',
    "releaseDate: '2026-10-01T00:00:00.000Z'",
  ].join('\n');
}

async function resolveFeedUpdate(channel: UpdateChannel, current: string, releases: readonly Release[]) {
  const requested: string[] = [];
  const latest = releases.find((release) => !release.prerelease);
  const executor = {
    request: async (request: { path: string }) => {
      requested.push(request.path);
      if (request.path === `${REPO}.atom`) return writeFeed(releases);
      if (request.path === `${REPO}/latest`) return JSON.stringify({ tag_name: latest?.tag });
      const [tag, file] = request.path.replace(`${REPO}/download/`, '').split('/');
      const release = releases.find((entry) => entry.tag === tag);
      const files = release?.prerelease ? ['beta-mac.yml'] : ['latest-mac.yml', 'beta-mac.yml'];
      if (!tag || !file || !files.includes(file)) throw new Error(`No ${request.path}`);
      return writeUpdateFile(tag);
    },
  } as unknown as ElectronHttpExecutor;
  const options = resolveUpdaterOptions(channel);
  const updater = { ...options, currentVersion: current, fullChangelog: false } as unknown as AppUpdater;
  const provider = new GitHubProvider({ provider: 'github', owner: 'shinsa-dev', repo: 'shinsa' }, updater, {
    isUseMultipleRangeRequest: false,
    platform: 'darwin',
    executor,
  });
  const info = await provider.getLatestVersion();
  const file = requested.at(-1)?.split('/').slice(-2).join('/');
  const order = resolveVersionOrder(info.version, current);
  return { version: info.version, file, offered: order === 1 };
}

const STABLE_3 = { tag: 'v3.0.0', prerelease: false };
const BETA_3_0_1 = { tag: 'v3.0.1-beta.1', prerelease: true };

describe('the release feed, read by electron-updater as each channel sets it up', () => {
  it('offers a newer stable release to a beta on Beta', async () => {
    const releases = [{ tag: 'v4.0.0', prerelease: false }, BETA_3_0_1, STABLE_3];
    expect(await resolveFeedUpdate('beta', '3.0.1-beta.1', releases)).toEqual({
      version: '4.0.0',
      file: 'v4.0.0/beta-mac.yml',
      offered: true,
    });
  });

  it('offers the newest pre-release on Beta, from a stable version too', async () => {
    const releases = [{ tag: 'v3.1.0-beta.2', prerelease: true }, STABLE_3];
    expect(await resolveFeedUpdate('beta', '3.0.0', releases)).toEqual({
      version: '3.1.0-beta.2',
      file: 'v3.1.0-beta.2/beta-mac.yml',
      offered: true,
    });
  });

  it('offers only the latest stable release on Stable, never a pre-release', async () => {
    const releases = [{ tag: 'v3.1.0-beta.1', prerelease: true }, STABLE_3];
    expect(await resolveFeedUpdate('stable', '2.9.0', releases)).toEqual({
      version: '3.0.0',
      file: 'v3.0.0/latest-mac.yml',
      offered: true,
    });
  });

  it('finds a lower stable release for a beta on Stable, which the app offers as going back', async () => {
    const update = await resolveFeedUpdate('stable', '3.0.1-beta.1', [BETA_3_0_1, STABLE_3]);
    expect(update).toEqual({ version: '3.0.0', file: 'v3.0.0/latest-mac.yml', offered: false });
    expect(
      resolveDowngradeOffer({
        channel: 'stable',
        current: '3.0.1-beta.1',
        latest: update.version,
        kept: null,
      })
    ).toBe('3.0.0');
  });

  it('takes the release published last on Beta, so a stable hotfix after a beta leads it', async () => {
    const releases = [
      { tag: 'v4.0.1', prerelease: false },
      { tag: 'v4.1.0-beta.1', prerelease: true },
    ];
    expect(await resolveFeedUpdate('beta', '4.0.0', releases)).toEqual({
      version: '4.0.1',
      file: 'v4.0.1/beta-mac.yml',
      offered: true,
    });
    expect((await resolveFeedUpdate('beta', '4.1.0-beta.1', releases)).offered).toBe(false);
  });
});
