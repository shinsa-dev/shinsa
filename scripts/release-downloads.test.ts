import { describe, expect, it } from 'bun:test';
import type { DownloadPointer } from '../apps/marketing/src/worker/download.ts';
import {
  assertDownloadFile,
  type ChannelPointers,
  type DownloadRelease,
  describeDownloadUpload,
  listPointerUploads,
  listStaleCanaryKeys,
  parseDownloadRelease,
  parseStoredPointer,
  parseTokenId,
  R2_ACCOUNT_ID,
  resolveChannelUpdates,
  resolveR2Credentials,
} from './release-downloads.ts';

const SHA = 'b'.repeat(64);

function viewOf(tag: string, overrides: Record<string, unknown> = {}, asset: Record<string, unknown> = {}) {
  return {
    tagName: tag,
    isDraft: false,
    isPrerelease: tag.includes('-'),
    publishedAt: '2026-10-27T12:11:13Z',
    assets: [
      { name: 'Shinsa-mac-arm64.zip', size: 1, digest: `sha256:${'c'.repeat(64)}` },
      { name: 'Shinsa-mac-arm64.dmg', size: 178563557, digest: `sha256:${SHA}`, ...asset },
    ],
    ...overrides,
  };
}

function pointerOf(version: string): DownloadPointer {
  return {
    version,
    key: `releases/${version}/Shinsa-mac-arm64.dmg`,
    size: 178563557,
    sha256: SHA,
    publishedAt: '2026-10-27T12:11:13Z',
  };
}

function releaseOf(tag: string): DownloadRelease {
  return parseDownloadRelease(viewOf(tag));
}

const NONE: ChannelPointers = { stable: null, beta: null, canary: null };

describe('parseDownloadRelease', () => {
  it('reads the release gh describes into the pointer its channel serves', () => {
    expect(parseDownloadRelease(viewOf('v1.0.0-beta.1'))).toEqual({
      tag: 'v1.0.0-beta.1',
      channel: 'beta',
      pointer: pointerOf('1.0.0-beta.1'),
    });
    expect(releaseOf('v1.0.0').channel).toBe('stable');
    expect(parseDownloadRelease(viewOf('v1.1.0', { isPrerelease: true })).channel).toBe('beta');
    expect(releaseOf('v1.1.1-canary.3').channel).toBe('canary');
  });

  it('refuses a release it cannot serve', () => {
    const cases: [unknown, string][] = [
      [null, 'gh did not describe a release.'],
      [{ tagName: 7 }, 'gh did not describe a release.'],
      [viewOf('v1.0.0', { isDraft: true }), 'v1.0.0 is a draft; publish it first.'],
      [viewOf('v1.0.0', { assets: [] }), 'v1.0.0 has no Shinsa-mac-arm64.dmg.'],
      [viewOf('v1.0.0', { assets: null }), 'v1.0.0 has no Shinsa-mac-arm64.dmg.'],
      [viewOf('v1.0.0', {}, { digest: null }), 'its Shinsa-mac-arm64.dmg has no size, digest or date.'],
      [viewOf('v1.0.0', {}, { digest: 'md5:abc' }), 'has no size, digest or date.'],
      [viewOf('nightly'), 'nightly is not a version'],
      [viewOf('v1.0.0', { publishedAt: null }), 'has no size, digest or date.'],
    ];
    for (const [view, message] of cases) {
      expect(() => parseDownloadRelease(view)).toThrow(message);
    }
  });
});

describe('assertDownloadFile', () => {
  it('takes the file GitHub describes', () => {
    expect(() => assertDownloadFile(releaseOf('v1.0.0'), { size: 178563557, sha256: SHA })).not.toThrow();
  });

  it('refuses a file of another size or digest', () => {
    const release = releaseOf('v1.0.0');
    for (const file of [
      { size: 1, sha256: SHA },
      { size: 178563557, sha256: 'd'.repeat(64) },
    ]) {
      expect(() => assertDownloadFile(release, file)).toThrow('is not the file GitHub describes');
    }
  });
});

describe('parseStoredPointer', () => {
  it('reads the pointer stored in the bucket', () => {
    expect(parseStoredPointer(JSON.stringify(pointerOf('1.0.0')))).toEqual(pointerOf('1.0.0'));
  });

  it('is null for a missing or unreadable pointer, so the release writes a new one', () => {
    expect(parseStoredPointer(null)).toBeNull();
    expect(parseStoredPointer('not json')).toBeNull();
    expect(parseStoredPointer('{}')).toBeNull();
  });
});

describe('the bucket credentials', () => {
  it('takes the token id from the account token check', () => {
    expect(parseTokenId({ success: true, result: { id: 'abc', status: 'active' } })).toBe('abc');
  });

  it('refuses a token the account does not know, naming the account', () => {
    for (const answer of [
      null,
      { success: false, errors: [] },
      { success: true, result: {} },
      { success: true },
    ]) {
      expect(() => parseTokenId(answer)).toThrow(`not an active token of the account ${R2_ACCOUNT_ID}`);
    }
  });

  it('uses the token id as the access key and the SHA-256 of the token as the secret, as R2 does', () => {
    expect(resolveR2Credentials('secret', 'abc')).toEqual({
      accessKeyId: 'abc',
      secretAccessKey: '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b',
    });
  });
});

describe('resolveChannelUpdates', () => {
  it('points beta at a new beta, and leaves stable and canary alone', () => {
    expect(resolveChannelUpdates(releaseOf('v1.0.0-beta.1'), NONE)).toEqual(['beta']);
    const current = { stable: pointerOf('1.0.0'), beta: pointerOf('1.1.0-beta.1'), canary: null };
    expect(resolveChannelUpdates(releaseOf('v1.1.0-beta.2'), current)).toEqual(['beta']);
  });

  it('points stable and beta at a new stable release, never canary', () => {
    expect(resolveChannelUpdates(releaseOf('v1.0.0'), NONE)).toEqual(['stable', 'beta']);
    const current = { stable: null, beta: pointerOf('1.0.0-beta.3'), canary: pointerOf('0.0.2-canary.4') };
    expect(resolveChannelUpdates(releaseOf('v1.0.0'), current)).toEqual(['stable', 'beta']);
  });

  it('points only canary at a canary', () => {
    const current = { stable: pointerOf('1.3.0'), beta: pointerOf('1.4.0-beta.1'), canary: null };
    expect(resolveChannelUpdates(releaseOf('v1.4.1-canary.1'), current)).toEqual(['canary']);
  });

  it('never moves a channel back to an older version, and rewrites the same one', () => {
    const current = {
      stable: pointerOf('1.3.0'),
      beta: pointerOf('1.4.0-beta.1'),
      canary: pointerOf('1.4.1-canary.2'),
    };
    expect(resolveChannelUpdates(releaseOf('v1.3.1'), current)).toEqual(['stable']);
    expect(resolveChannelUpdates(releaseOf('v1.3.1-beta.1'), current)).toEqual([]);
    expect(resolveChannelUpdates(releaseOf('v1.4.0-beta.1'), current)).toEqual(['beta']);
    expect(resolveChannelUpdates(releaseOf('v1.4.1-canary.1'), current)).toEqual([]);
    expect(resolveChannelUpdates(releaseOf('v1.4.1-canary.2'), current)).toEqual(['canary']);
    expect(resolveChannelUpdates(releaseOf('v1.4.1'), current)).toEqual(['stable', 'beta']);
  });
});

describe('listPointerUploads', () => {
  it('writes the release pointer to each channel it updates', () => {
    const release = releaseOf('v1.0.0');
    expect(listPointerUploads(release, ['stable', 'beta'])).toEqual([
      { key: 'channels/stable.json', body: `${JSON.stringify(pointerOf('1.0.0'))}\n` },
      { key: 'channels/beta.json', body: `${JSON.stringify(pointerOf('1.0.0'))}\n` },
    ]);
  });
});

describe('describeDownloadUpload', () => {
  const current = {
    stable: pointerOf('1.3.0'),
    beta: pointerOf('1.4.0-beta.1'),
    canary: pointerOf('1.4.1-canary.2'),
  };

  it('says what the stable and beta addresses serve after a beta, and nothing of canary', () => {
    expect(describeDownloadUpload(releaseOf('v1.0.0-beta.1'), ['beta'], NONE)).toBe(
      'Uploaded `releases/1.0.0-beta.1/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download serves the beta until the first stable release. shinsa.dev/download/beta now serves 1.0.0-beta.1.'
    );
    expect(describeDownloadUpload(releaseOf('v1.5.0-beta.1'), ['beta'], current)).toBe(
      'Uploaded `releases/1.5.0-beta.1/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download still serves 1.3.0. shinsa.dev/download/beta now serves 1.5.0-beta.1.'
    );
  });

  it('says what the stable and beta addresses serve after a stable release, and nothing of canary', () => {
    expect(describeDownloadUpload(releaseOf('v1.3.1'), ['stable'], current)).toBe(
      'Uploaded `releases/1.3.1/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download now serves 1.3.1. shinsa.dev/download/beta keeps 1.4.0-beta.1, which is newer.'
    );
  });

  it('says only what the canary address serves after a canary', () => {
    expect(describeDownloadUpload(releaseOf('v1.4.1-canary.3'), ['canary'], current)).toBe(
      'Uploaded `releases/1.4.1-canary.3/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download/canary now serves 1.4.1-canary.3.'
    );
    expect(describeDownloadUpload(releaseOf('v1.4.1-canary.1'), [], current)).toBe(
      'Uploaded `releases/1.4.1-canary.1/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download/canary keeps 1.4.1-canary.2, which is newer.'
    );
  });
});

describe('listStaleCanaryKeys', () => {
  it('lists the disk images of all but the newest canaries, never a beta, a stable release or another key', () => {
    const keys = [
      'releases/1.3.0/Shinsa-mac-arm64.dmg',
      'releases/1.4.0-beta.1/Shinsa-mac-arm64.dmg',
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => `releases/1.4.1-canary.${n}/Shinsa-mac-arm64.dmg`),
      'releases/1.4.1-canary.8/notes.txt',
      'releases/nightly/Shinsa-mac-arm64.dmg',
    ];
    expect(listStaleCanaryKeys(keys)).toEqual([
      'releases/1.4.1-canary.2/Shinsa-mac-arm64.dmg',
      'releases/1.4.1-canary.1/Shinsa-mac-arm64.dmg',
    ]);
  });
});
