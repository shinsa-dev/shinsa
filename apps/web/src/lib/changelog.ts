import {
  type Changelog,
  type ChangelogRelease,
  DEVELOPMENT_VERSION,
  listUnseenReleases,
  resolveVersionOrder,
} from '@shinsa/core';
import { Effect } from 'effect';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { connection, useEngineFeature } from '@/lib/connection/socket.ts';
import { formatDay } from '@/lib/format/time.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';
import { createSignal } from '@/lib/signal.ts';

export const CHANGELOG_SEEN_KEY = 'shinsa.changelog-seen';

export const CHANGELOG_ICON = 'IconGift1';

export const CHANGELOG_COPY = {
  button: 'What’s new',
  title: 'What’s new in Shinsa',
  everything: 'Every change to Shinsa, newest first.',
  empty: 'No changes are listed yet.',
  unreleased: 'Not released yet',
  open: 'Open the changelog',
  row: 'Changelog',
  rowDetail: 'What changed in each version of Shinsa.',
} as const;

interface ChangelogView {
  changelog: Changelog | null;
  readFor: string | null;
  failure: string | null;
  open: boolean;
  since: string | null;
}

const CLOSED: ChangelogView = { changelog: null, readFor: null, failure: null, open: false, since: null };

const signal = createSignal();

let view: ChangelogView = CLOSED;

function publish(patch: Partial<ChangelogView>) {
  view = { ...view, ...patch };
  signal.publish();
}

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    const readFor = selectEngineVersion();
    const answer = yield* engine.changelog.list().pipe(
      Effect.match({
        onFailure: (error) => ({ failure: describeFailure(error) }),
        onSuccess: (changelog) => ({ changelog, failure: null }),
      })
    );
    publish({ ...answer, readFor });
  })
);

function selectEngineVersion() {
  return connection.selectEngine()?.version ?? null;
}

function isChangelogStale(version: string | null) {
  return !view.changelog || view.readFor !== version;
}

export function refreshChangelog() {
  return read.run();
}

export function resetChangelog() {
  read.reset();
  view = CLOSED;
  signal.publish();
}

export function selectChangelogView() {
  return view;
}

export function selectSeenVersion() {
  return localStorage.getItem(CHANGELOG_SEEN_KEY);
}

function recordSeenVersion(version: string) {
  localStorage.setItem(CHANGELOG_SEEN_KEY, version);
  signal.publish();
}

function isReleasedVersion(version: string | null): version is string {
  return version !== null && version !== DEVELOPMENT_VERSION;
}

export function resolveWhatsNew(
  changelog: Changelog | null,
  version: string | null,
  seen: string | null
): ChangelogRelease[] {
  if (!changelog || !isReleasedVersion(version) || seen === null) return [];
  return listUnseenReleases(changelog, seen).filter(
    (release) => release.version !== null && resolveVersionOrder(release.version, version) !== 1
  );
}

export function openChangelog(since: string | null = null) {
  const version = selectEngineVersion();
  if (isReleasedVersion(version)) recordSeenVersion(version);
  publish({ open: true, since });
  if (isChangelogStale(version)) void read.run();
}

export function closeChangelog() {
  publish({ open: false });
}

export function listShownReleases(shown: ChangelogView): readonly ChangelogRelease[] {
  if (!shown.changelog) return [];
  if (shown.since === null) return shown.changelog.releases;
  return listUnseenReleases(shown.changelog, shown.since);
}

export function describeChangelogSince(since: string | null) {
  if (since === null) return CHANGELOG_COPY.everything;
  return `Everything that changed since Shinsa ${since}.`;
}

export function describeReleaseTitle(release: ChangelogRelease) {
  return release.version === null ? CHANGELOG_COPY.unreleased : `Shinsa ${release.version}`;
}

export function describeReleaseDate(release: ChangelogRelease) {
  if (release.date === null) return null;
  const at = Date.parse(`${release.date}T12:00:00`);
  return Number.isNaN(at) ? null : formatDay(at);
}

export function useChangelogView() {
  return React.useSyncExternalStore(signal.subscribe, selectChangelogView);
}

export function useChangelogAvailable() {
  return useEngineFeature('changelog');
}

export function useWhatsNew() {
  const available = useChangelogAvailable();
  const version = React.useSyncExternalStore(connection.subscribe, selectEngineVersion);
  const seen = React.useSyncExternalStore(signal.subscribe, selectSeenVersion);
  const shown = useChangelogView();
  const known = available && isReleasedVersion(version);
  React.useEffect(() => {
    if (!known) return;
    if (seen === null) recordSeenVersion(version);
    else if (view.readFor !== version && resolveVersionOrder(version, seen) === 1) void read.run();
  }, [known, version, seen]);
  if (!known) return { releases: [], seen };
  return { releases: resolveWhatsNew(shown.changelog, version, seen), seen };
}
