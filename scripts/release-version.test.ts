import { describe, expect, it } from 'bun:test';
import {
  BETA_DOWNLOAD_URL,
  describeReleaseChannel,
  parseReleaseOptions,
  resolveReleasePlan,
} from './release-version.ts';

const TAGS = [
  'v1.1.0',
  'v1.2.0',
  'v1.10.0-beta.1',
  'v1.3.0-beta.1',
  'v1.3.0-beta.2',
  'v1.2.1-beta.1',
  'v0.9.0',
];

describe('parseReleaseOptions', () => {
  it('takes the workflow inputs as they are', () => {
    expect(parseReleaseOptions('beta', 'minor')).toEqual({ channel: 'beta', bump: 'minor' });
    expect(parseReleaseOptions('stable', 'major')).toEqual({ channel: 'stable', bump: 'major' });
  });

  it('refuses a channel or a bump it does not know', () => {
    expect(() => parseReleaseOptions('nightly', 'patch')).toThrow(
      'The channel must be stable or beta, not "nightly".'
    );
    expect(() => parseReleaseOptions(undefined, 'patch')).toThrow('not "".');
    expect(() => parseReleaseOptions('stable', 'huge')).toThrow(
      'The bump must be patch, minor or major, not "huge".'
    );
    expect(() => parseReleaseOptions('stable', undefined)).toThrow('not "".');
  });
});

describe('resolveReleasePlan', () => {
  it('starts at 0.0.0 when nothing was released', () => {
    expect(resolveReleasePlan({ tags: [], channel: 'stable', bump: 'patch' })).toEqual({
      channel: 'stable',
      version: '0.0.1',
      tag: 'v0.0.1',
      prerelease: false,
      lastStable: null,
      notesStartTag: null,
    });
    expect(resolveReleasePlan({ tags: [], channel: 'beta', bump: 'minor' }).version).toBe('0.1.0-beta.1');
  });

  it('makes the first releases 1.0.0 with a major bump: betas of 1.0.0, then 1.0.0', () => {
    expect(resolveReleasePlan({ tags: [], channel: 'beta', bump: 'major' })).toEqual({
      channel: 'beta',
      version: '1.0.0-beta.1',
      tag: 'v1.0.0-beta.1',
      prerelease: true,
      lastStable: null,
      notesStartTag: null,
    });
    const betas = ['v1.0.0-beta.1', 'v1.0.0-beta.2'];
    expect(resolveReleasePlan({ tags: betas, channel: 'beta', bump: 'major' }).version).toBe('1.0.0-beta.3');
    expect(resolveReleasePlan({ tags: betas, channel: 'stable', bump: 'major' })).toEqual({
      channel: 'stable',
      version: '1.0.0',
      tag: 'v1.0.0',
      prerelease: false,
      lastStable: null,
      notesStartTag: null,
    });
    const released = [...betas, 'v1.0.0'];
    expect(resolveReleasePlan({ tags: released, channel: 'beta', bump: 'minor' }).version).toBe(
      '1.1.0-beta.1'
    );
  });

  it('bumps the highest stable tag by semver order, ignoring prereleases and tag order', () => {
    expect(resolveReleasePlan({ tags: TAGS, channel: 'stable', bump: 'patch' })).toEqual({
      channel: 'stable',
      version: '1.2.1',
      tag: 'v1.2.1',
      prerelease: false,
      lastStable: '1.2.0',
      notesStartTag: 'v1.2.0',
    });
    expect(resolveReleasePlan({ tags: TAGS, channel: 'stable', bump: 'minor' }).version).toBe('1.3.0');
    expect(resolveReleasePlan({ tags: TAGS, channel: 'stable', bump: 'major' }).version).toBe('2.0.0');
    expect(
      resolveReleasePlan({ tags: ['v1.10.0', 'v1.9.0'], channel: 'stable', bump: 'patch' }).version
    ).toBe('1.10.1');
  });

  it('makes a beta a prerelease of the next version, counting that version’s betas', () => {
    expect(resolveReleasePlan({ tags: TAGS, channel: 'beta', bump: 'minor' })).toEqual({
      channel: 'beta',
      version: '1.3.0-beta.3',
      tag: 'v1.3.0-beta.3',
      prerelease: true,
      lastStable: '1.2.0',
      notesStartTag: null,
    });
    expect(resolveReleasePlan({ tags: TAGS, channel: 'beta', bump: 'patch' }).version).toBe('1.2.1-beta.2');
    expect(resolveReleasePlan({ tags: TAGS, channel: 'beta', bump: 'major' }).version).toBe('2.0.0-beta.1');
    expect(
      resolveReleasePlan({
        tags: ['v1.2.0', 'v1.3.0-beta.9', 'v1.3.0-beta.10'],
        channel: 'beta',
        bump: 'minor',
      }).version
    ).toBe('1.3.0-beta.11');
  });

  it('starts the betas again once the version they led to ships', () => {
    const shipped = [...TAGS, 'v1.3.0'];
    expect(resolveReleasePlan({ tags: shipped, channel: 'beta', bump: 'minor' }).version).toBe(
      '1.4.0-beta.1'
    );
    expect(resolveReleasePlan({ tags: shipped, channel: 'beta', bump: 'patch' }).version).toBe(
      '1.3.1-beta.1'
    );
  });
});

describe('describeReleaseChannel', () => {
  it('says who updates to the release', () => {
    expect(
      describeReleaseChannel({
        channel: 'stable',
        version: '1.3.0',
        tag: 'v1.3.0',
        prerelease: false,
        lastStable: '1.2.0',
        notesStartTag: 'v1.2.0',
      })
    ).toBe(
      '**Stable release.** Shinsa updates itself to 1.3.0 on the Stable channel, and on the Beta channel unless it already runs a newer beta.'
    );
    expect(
      describeReleaseChannel({
        channel: 'beta',
        version: '1.3.0-beta.2',
        tag: 'v1.3.0-beta.2',
        prerelease: true,
        lastStable: '1.2.0',
        notesStartTag: null,
      })
    ).toBe(
      `**Beta of Shinsa 1.3.0.** Only Shinsa on the Beta channel updates itself to it (Settings → General → Updates). Download it at ${BETA_DOWNLOAD_URL}.`
    );
  });
});
