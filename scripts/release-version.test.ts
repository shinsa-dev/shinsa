import { describe, expect, it } from 'bun:test';
import {
  BETA_DOWNLOAD_URL,
  CANARY_DOWNLOAD_URL,
  describeCanaryDecision,
  describeReleaseChannel,
  isAppChange,
  listStaleCanaries,
  parseReleaseOptions,
  resolveCanaryDecision,
  resolveReleasePlan,
  selectLastCanaryTag,
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
    expect(parseReleaseOptions('canary', 'patch')).toEqual({ channel: 'canary', bump: 'patch' });
  });

  it('refuses a channel or a bump it does not know', () => {
    expect(() => parseReleaseOptions('nightly', 'patch')).toThrow(
      'The channel must be stable, beta or canary, not "nightly".'
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

describe('resolveReleasePlan for a canary', () => {
  it('takes the version of the newest beta, counting that version’s canaries', () => {
    expect(resolveReleasePlan({ tags: TAGS, channel: 'canary', bump: 'major' })).toEqual({
      channel: 'canary',
      version: '1.10.0-canary.1',
      tag: 'v1.10.0-canary.1',
      prerelease: true,
      lastStable: '1.2.0',
      notesStartTag: null,
    });
    const betas = ['v1.0.0-beta.4', 'v1.0.0-beta.5', 'v1.0.0-canary.1', 'v1.0.0-canary.2'];
    expect(resolveReleasePlan({ tags: betas, channel: 'canary', bump: 'patch' })).toEqual({
      channel: 'canary',
      version: '1.0.0-canary.3',
      tag: 'v1.0.0-canary.3',
      prerelease: true,
      lastStable: null,
      notesStartTag: 'v1.0.0-canary.2',
    });
  });

  it('takes the patch after the newest stable release when no beta is above it', () => {
    const canaries = ['v1.2.0', 'v1.2.0-beta.3', 'v1.2.1-canary.1', 'v1.2.1-canary.2', 'v1.2.0-canary.7'];
    expect(resolveReleasePlan({ tags: canaries, channel: 'canary', bump: 'patch' })).toEqual({
      channel: 'canary',
      version: '1.2.1-canary.3',
      tag: 'v1.2.1-canary.3',
      prerelease: true,
      lastStable: '1.2.0',
      notesStartTag: 'v1.2.1-canary.2',
    });
  });

  it('starts at 0.0.1 and follows each beta and stable release as they ship', () => {
    expect(resolveReleasePlan({ tags: [], channel: 'canary', bump: 'patch' }).version).toBe('0.0.1-canary.1');
    expect(resolveReleasePlan({ tags: ['v1.0.0-beta.5'], channel: 'canary', bump: 'patch' }).version).toBe(
      '1.0.0-canary.1'
    );
    const tags = ['v1.2.0', 'v1.2.1-canary.4'];
    const beta = [...tags, 'v1.3.0-beta.1'];
    expect(resolveReleasePlan({ tags: beta, channel: 'canary', bump: 'patch' }).version).toBe(
      '1.3.0-canary.1'
    );
    const patch = [...tags, 'v1.2.1-beta.1'];
    expect(resolveReleasePlan({ tags: patch, channel: 'canary', bump: 'patch' }).version).toBe(
      '1.2.1-canary.5'
    );
    const stable = [...beta, 'v1.3.0-canary.2', 'v1.3.0'];
    expect(resolveReleasePlan({ tags: stable, channel: 'canary', bump: 'patch' })).toMatchObject({
      version: '1.3.1-canary.1',
      notesStartTag: 'v1.3.0-canary.2',
    });
    const hotfix = [...stable, 'v1.4.0-beta.1', 'v1.4.0-canary.3', 'v1.3.1'];
    expect(resolveReleasePlan({ tags: hotfix, channel: 'canary', bump: 'patch' }).version).toBe(
      '1.4.0-canary.4'
    );
  });

  it('never counts a canary as the last stable release or the base of a beta', () => {
    const tags = ['v1.2.0', 'v1.2.1-canary.9', 'v1.3.1-canary.2'];
    expect(resolveReleasePlan({ tags, channel: 'stable', bump: 'patch' }).version).toBe('1.2.1');
    expect(resolveReleasePlan({ tags, channel: 'beta', bump: 'minor' }).version).toBe('1.3.0-beta.1');
  });
});

describe('listStaleCanaries', () => {
  it('keeps the newest canaries by semver and lists the rest, never a beta or stable release', () => {
    const tags = [
      'v1.2.0',
      'v1.3.0-beta.1',
      'v1.2.1-canary.9',
      'v1.2.1-canary.10',
      'v1.3.1-canary.1',
      'v1.2.1-canary.2',
    ];
    expect(listStaleCanaries(tags, 2)).toEqual(['v1.2.1-canary.9', 'v1.2.1-canary.2']);
    expect(listStaleCanaries(tags)).toEqual([]);
    expect(listStaleCanaries(['v1.2.0'], 0)).toEqual([]);
    expect(listStaleCanaries(['1.2.1-canary.1', '1.2.1-canary.2'], 1)).toEqual(['1.2.1-canary.1']);
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
      '**Stable release.** Shinsa updates itself to 1.3.0 on the Stable and Beta channels, unless it already runs a newer beta. The Canary channel takes the next canary, built above it.'
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
      `**Beta of Shinsa 1.3.0.** Shinsa on the Beta channel updates itself to it, unless it already runs a newer version (Settings → General → Updates). Download it at ${BETA_DOWNLOAD_URL}.`
    );
    expect(
      describeReleaseChannel({
        channel: 'canary',
        version: '1.3.1-canary.4',
        tag: 'v1.3.1-canary.4',
        prerelease: true,
        lastStable: '1.2.0',
        notesStartTag: 'v1.3.1-canary.3',
      })
    ).toBe(
      `**Canary build of main.** Shinsa on the Canary channel updates itself to it (Settings → General → Updates). Download it at ${CANARY_DOWNLOAD_URL}.`
    );
  });
});

describe('which commits of main get a canary', () => {
  it('skips changes to docs, the site, Markdown at the root, CLAUDE.md files, agent notes and README assets', () => {
    for (const path of [
      'docs/release.md',
      'apps/marketing/src/worker/download.ts',
      'README.md',
      'CLAUDE.md',
      'apps/engine/CLAUDE.md',
      '.claude/skills/copy/SKILL.md',
      '.github/assets/shinsa-light.png',
    ])
      expect(isAppChange(path)).toBe(false);
    for (const path of [
      'apps/desktop/src/main/index.ts',
      'apps/engine/plugin/skills/review/SKILL.md',
      'packages/core/README.md',
      '.github/workflows/release.yml',
      'bun.lock',
    ])
      expect(isAppChange(path)).toBe(true);
  });

  it('compares with the newest canary, so a merge whose canary was cancelled still gets one', () => {
    const tags = ['v1.2.0', 'v1.3.1-canary.2', 'v1.3.1-canary.10', 'v1.3.0-beta.1'];
    expect(selectLastCanaryTag(tags)).toBe('v1.3.1-canary.10');
    expect(selectLastCanaryTag(['v1.2.0'])).toBeNull();
  });

  it('builds the first canary, and later ones only when the app changed', () => {
    const first = resolveCanaryDecision(null, []);
    expect(first).toEqual({ build: true, reason: 'first', base: null, files: [] });
    expect(describeCanaryDecision(first)).toBe('Building a canary: there is no canary before it.');
    const docs = resolveCanaryDecision('v1.3.1-canary.2', ['docs/engine.md', 'README.md']);
    expect(docs).toEqual({ build: false, reason: 'unchanged', base: 'v1.3.1-canary.2', files: [] });
    expect(describeCanaryDecision(docs)).toBe(
      'No canary: nothing since v1.3.1-canary.2 changes the app, only docs, the site or agent notes.'
    );
    const app = resolveCanaryDecision('v1.3.1-canary.2', ['docs/engine.md', 'apps/web/src/main.tsx']);
    expect(app).toMatchObject({ build: true, reason: 'changed', files: ['apps/web/src/main.tsx'] });
    expect(describeCanaryDecision(app)).toBe(
      'Building a canary: since v1.3.1-canary.2, `apps/web/src/main.tsx` changed.'
    );
    const many = resolveCanaryDecision(
      'v1.3.1-canary.2',
      Array.from({ length: 7 }, (_, index) => `apps/web/src/${index}.ts`)
    );
    expect(describeCanaryDecision(many)).toBe(
      'Building a canary: since v1.3.1-canary.2, `apps/web/src/0.ts`, `apps/web/src/1.ts`, `apps/web/src/2.ts`, `apps/web/src/3.ts`, `apps/web/src/4.ts` and 2 more changed.'
    );
  });
});
