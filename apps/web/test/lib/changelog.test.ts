import { describe, expect, it } from 'bun:test';
import { type Changelog, DEVELOPMENT_VERSION, resolveEngineInfo } from '@shinsa/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  CHANGELOG_SEEN_KEY,
  closeChangelog,
  describeChangelogSince,
  describeReleaseDate,
  describeReleaseTitle,
  listShownReleases,
  openChangelog,
  refreshChangelog,
  resolveWhatsNew,
  selectChangelogView,
  selectSeenVersion,
  useWhatsNew,
} from '@/lib/changelog.ts';
import { spyOnEngine } from '../support/engine.ts';
import { answerFetch } from '../support/fetch-fake.ts';

const CHANGELOG: Changelog = {
  releases: [
    {
      version: '1.3.0',
      date: '2026-11-02',
      changes: [
        { slug: 'whats-new', kind: 'added', text: 'Shinsa shows what changed after an update.' },
        { slug: 'queue-order', kind: 'fixed', text: 'The queue keeps its order after a restart.' },
      ],
    },
    {
      version: '1.2.0',
      date: '2026-10-01',
      changes: [{ slug: 'faster-chat', kind: 'improved', text: 'Long chats open faster.' }],
    },
    {
      version: '1.1.0',
      date: null,
      changes: [{ slug: 'first', kind: 'added', text: 'The first entry.' }],
    },
  ],
};

function answerChangelog(changelog: Changelog = CHANGELOG) {
  return answerFetch(() => Response.json(changelog));
}

function listVersions(releases: readonly { version: string | null }[]) {
  return releases.map((release) => release.version);
}

describe('resolveWhatsNew', () => {
  it('lists the releases after the one you saw, up to the version running', () => {
    expect(listVersions(resolveWhatsNew(CHANGELOG, '1.3.0', '1.1.0'))).toEqual(['1.3.0', '1.2.0']);
    expect(listVersions(resolveWhatsNew(CHANGELOG, '1.2.0', '1.1.0'))).toEqual(['1.2.0']);
    expect(resolveWhatsNew(CHANGELOG, '1.3.0', '1.3.0')).toEqual([]);
  });

  it('shows nothing without a changelog, a released version or a version you saw', () => {
    expect(resolveWhatsNew(null, '1.3.0', '1.1.0')).toEqual([]);
    expect(resolveWhatsNew(CHANGELOG, null, '1.1.0')).toEqual([]);
    expect(resolveWhatsNew(CHANGELOG, DEVELOPMENT_VERSION, '1.1.0')).toEqual([]);
    expect(resolveWhatsNew(CHANGELOG, '1.3.0', null)).toEqual([]);
  });
});

describe('useWhatsNew', () => {
  it('remembers a fresh install’s version without reading the changelog or showing anything', async () => {
    spyOnEngine(resolveEngineInfo('1.3.0'));
    const requests = answerChangelog();
    const { result } = renderHook(() => useWhatsNew());
    await waitFor(() => expect(selectSeenVersion()).toBe('1.3.0'));
    expect(result.current.releases).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('after an update, lists what changed until you open it, then nothing', async () => {
    localStorage.setItem(CHANGELOG_SEEN_KEY, '1.1.0');
    spyOnEngine(resolveEngineInfo('1.3.0'));
    const requests = answerChangelog();
    const { result } = renderHook(() => useWhatsNew());
    await waitFor(() => expect(listVersions(result.current.releases)).toEqual(['1.3.0', '1.2.0']));
    expect(result.current.seen).toBe('1.1.0');
    expect(requests.map((request) => request.path)).toEqual(['/api/changelog']);

    act(() => openChangelog('1.1.0'));
    expect(selectSeenVersion()).toBe('1.3.0');
    expect(result.current.releases).toEqual([]);
    expect(listVersions(listShownReleases(selectChangelogView()))).toEqual(['1.3.0', '1.2.0']);
    expect(requests).toHaveLength(1);

    act(() => closeChangelog());
    expect(selectChangelogView().open).toBe(false);
  });

  it('reads the changelog again when the engine updates while the page stays open', async () => {
    localStorage.setItem(CHANGELOG_SEEN_KEY, '1.1.0');
    const engine = spyOnEngine(resolveEngineInfo('1.2.0'));
    let answer: Changelog = { releases: CHANGELOG.releases.slice(1) };
    const requests = answerFetch(() => Response.json(answer));
    const { result, rerender } = renderHook(() => useWhatsNew());
    await waitFor(() => expect(listVersions(result.current.releases)).toEqual(['1.2.0']));

    answer = CHANGELOG;
    engine.mockReturnValue(resolveEngineInfo('1.3.0'));
    rerender();
    await waitFor(() => expect(listVersions(result.current.releases)).toEqual(['1.3.0', '1.2.0']));
    expect(requests.map((request) => request.path)).toEqual(['/api/changelog', '/api/changelog']);
  });

  it('reads nothing while the version you saw is the one running', async () => {
    localStorage.setItem(CHANGELOG_SEEN_KEY, '1.3.0');
    spyOnEngine(resolveEngineInfo('1.3.0'));
    const requests = answerChangelog();
    const { result } = renderHook(() => useWhatsNew());
    await act(async () => {});
    expect(result.current.releases).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('stays out of the way on an engine without a changelog and on a development build', async () => {
    const requests = answerChangelog();
    const engine = spyOnEngine({ ...resolveEngineInfo('1.3.0'), features: [] });
    const older = renderHook(() => useWhatsNew());
    await act(async () => {});
    expect(older.result.current.releases).toEqual([]);
    older.unmount();
    engine.mockReturnValue(resolveEngineInfo(DEVELOPMENT_VERSION));
    const development = renderHook(() => useWhatsNew());
    await act(async () => {});
    expect(development.result.current.releases).toEqual([]);
    expect(selectSeenVersion()).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe('the changelog dialog', () => {
  it('opens the whole changelog, reading it once, and keeps your seen version on a development build', async () => {
    spyOnEngine(resolveEngineInfo(DEVELOPMENT_VERSION));
    const requests = answerChangelog();
    act(() => openChangelog());
    expect(selectChangelogView()).toMatchObject({ open: true, since: null });
    expect(listShownReleases(selectChangelogView())).toEqual([]);
    await waitFor(() => expect(selectChangelogView().changelog).toEqual(CHANGELOG));
    expect(listVersions(listShownReleases(selectChangelogView()))).toEqual(['1.3.0', '1.2.0', '1.1.0']);
    expect(selectSeenVersion()).toBeNull();
    await refreshChangelog();
    expect(requests).toHaveLength(2);
  });

  it('keeps the engine’s refusal to show in place of the list', async () => {
    answerFetch(() =>
      Response.json({ error: { code: 'nope', message: 'The engine is busy.' } }, { status: 500 })
    );
    await refreshChangelog();
    expect(selectChangelogView().failure).not.toBeNull();
    expect(selectChangelogView().changelog).toBeNull();
  });

  it('names each release, its date and what it covers', () => {
    const [newest, , oldest] = CHANGELOG.releases;
    if (!(newest && oldest)) throw new Error('Expected releases');
    expect(describeReleaseTitle(newest)).toBe('Shinsa 1.3.0');
    expect(describeReleaseTitle({ ...newest, version: null })).toBe('Not released yet');
    expect(describeReleaseDate(newest)).toBe('Mon, Nov 2, 2026');
    expect(describeReleaseDate(oldest)).toBeNull();
    expect(describeReleaseDate({ ...newest, date: 'soon' })).toBeNull();
    expect(describeChangelogSince(null)).toBe('Every change to Shinsa, newest first.');
    expect(describeChangelogSince('1.1.0')).toBe('Everything that changed since Shinsa 1.1.0.');
  });
});
