import { describe, expect, it } from 'bun:test';
import type { DownloadPointer } from '../apps/marketing/src/worker/download.ts';
import {
  assertDownloadFile,
  type ChannelPointers,
  type DownloadRelease,
  describeDownloadUpload,
  listPointerUploads,
  MAX_UPLOAD_BYTES,
  parseDownloadRelease,
  parseStoredPointer,
  resolveChannelUpdates,
  resolveObjectPath,
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

const NONE: ChannelPointers = { stable: null, beta: null };

describe('parseDownloadRelease', () => {
  it('reads the release gh describes into the pointer its channel serves', () => {
    expect(parseDownloadRelease(viewOf('v1.0.0-beta.1'))).toEqual({
      tag: 'v1.0.0-beta.1',
      channel: 'beta',
      pointer: pointerOf('1.0.0-beta.1'),
    });
    expect(releaseOf('v1.0.0').channel).toBe('stable');
    expect(parseDownloadRelease(viewOf('v1.1.0', { isPrerelease: true })).channel).toBe('beta');
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

  it('refuses a file of another size or digest, or one too large to upload', () => {
    const release = releaseOf('v1.0.0');
    for (const file of [
      { size: 1, sha256: SHA },
      { size: 178563557, sha256: 'd'.repeat(64) },
    ]) {
      expect(() => assertDownloadFile(release, file)).toThrow('is not the file GitHub describes');
    }
    const huge = { ...release, pointer: { ...release.pointer, size: MAX_UPLOAD_BYTES + 1 } };
    expect(() => assertDownloadFile(huge, { size: MAX_UPLOAD_BYTES + 1, sha256: SHA })).toThrow(
      'wrangler uploads at most'
    );
  });
});

describe('parseStoredPointer', () => {
  it('reads the pointer wrangler printed', () => {
    const stdout = JSON.stringify(pointerOf('1.0.0'));
    expect(parseStoredPointer({ exitCode: 0, stdout, stderr: '' })).toEqual(pointerOf('1.0.0'));
  });

  it('is null for a missing or unreadable pointer, so the release writes a new one', () => {
    const missing = { exitCode: 1, stdout: '', stderr: '✘ [ERROR] The specified key does not exist.' };
    expect(parseStoredPointer(missing)).toBeNull();
    expect(parseStoredPointer({ exitCode: 0, stdout: 'not json', stderr: '' })).toBeNull();
    expect(parseStoredPointer({ exitCode: 0, stdout: '{}', stderr: '' })).toBeNull();
  });

  it('throws on any other failure, so a token without R2 access stops the upload', () => {
    expect(() =>
      parseStoredPointer({ exitCode: 1, stdout: '', stderr: ' Authentication error [code: 10000]\n' })
    ).toThrow('Reading a channel pointer failed: Authentication error [code: 10000]');
  });
});

describe('resolveChannelUpdates', () => {
  it('points beta at a new beta, and leaves stable alone', () => {
    expect(resolveChannelUpdates(releaseOf('v1.0.0-beta.1'), NONE)).toEqual(['beta']);
    const current = { stable: pointerOf('1.0.0'), beta: pointerOf('1.1.0-beta.1') };
    expect(resolveChannelUpdates(releaseOf('v1.1.0-beta.2'), current)).toEqual(['beta']);
  });

  it('points both channels at a new stable release', () => {
    expect(resolveChannelUpdates(releaseOf('v1.0.0'), NONE)).toEqual(['stable', 'beta']);
    const current = { stable: null, beta: pointerOf('1.0.0-beta.3') };
    expect(resolveChannelUpdates(releaseOf('v1.0.0'), current)).toEqual(['stable', 'beta']);
  });

  it('never moves a channel back to an older version, and rewrites the same one', () => {
    const current = { stable: pointerOf('1.3.0'), beta: pointerOf('1.4.0-beta.1') };
    expect(resolveChannelUpdates(releaseOf('v1.3.1'), current)).toEqual(['stable']);
    expect(resolveChannelUpdates(releaseOf('v1.3.1-beta.1'), current)).toEqual([]);
    expect(resolveChannelUpdates(releaseOf('v1.4.0-beta.1'), current)).toEqual(['beta']);
  });
});

describe('listPointerUploads', () => {
  it('writes the release pointer to each channel it updates', () => {
    const release = releaseOf('v1.0.0');
    expect(listPointerUploads(release, ['stable', 'beta'])).toEqual([
      { path: 'shinsa-releases/channels/stable.json', body: `${JSON.stringify(pointerOf('1.0.0'))}\n` },
      { path: 'shinsa-releases/channels/beta.json', body: `${JSON.stringify(pointerOf('1.0.0'))}\n` },
    ]);
    expect(resolveObjectPath(release.pointer.key)).toBe(
      'shinsa-releases/releases/1.0.0/Shinsa-mac-arm64.dmg'
    );
  });
});

describe('describeDownloadUpload', () => {
  it('says what each download address serves now', () => {
    expect(describeDownloadUpload(releaseOf('v1.0.0-beta.1'), ['beta'], NONE)).toBe(
      'Uploaded `releases/1.0.0-beta.1/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download serves the beta until the first stable release. shinsa.dev/download/beta now serves 1.0.0-beta.1.'
    );
    const current = { stable: pointerOf('1.3.0'), beta: pointerOf('1.4.0-beta.1') };
    expect(describeDownloadUpload(releaseOf('v1.3.1'), ['stable'], current)).toBe(
      'Uploaded `releases/1.3.1/Shinsa-mac-arm64.dmg` to R2 (`shinsa-releases`). shinsa.dev/download now serves 1.3.1. shinsa.dev/download/beta keeps 1.4.0-beta.1, which is newer.'
    );
  });
});
