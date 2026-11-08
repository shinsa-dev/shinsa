import type { SlackDirectoryView, SlackSnapshot } from '@shinsa/core';
import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';
import { createSignal } from '@/lib/signal.ts';

interface SlackView {
  snapshot: SlackSnapshot | null;
  failure: string | null;
}

const signal = createSignal();

const EMPTY: SlackView = { snapshot: null, failure: null };

let view: SlackView = EMPTY;

function publish(next: SlackView) {
  view = next;
  signal.publish();
}

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    const snapshot = yield* engine.slack.snapshot();
    publish({ snapshot, failure: null });
  }).pipe(Effect.catch((error) => Effect.sync(() => publish({ ...view, failure: error.message }))))
);

const disconnect = Effect.gen(function* () {
  const engine = yield* EngineClient;
  const snapshot = yield* engine.slack.disconnect();
  publish({ snapshot, failure: null });
  return snapshot;
});

export function selectSlack() {
  return view;
}

export function resetSlack() {
  read.reset();
  publish(EMPTY);
}

export function refreshSlack() {
  return read.run();
}

export interface SlackActions {
  disconnect: () => Promise<unknown>;
}

export const SLACK_ACTIONS: SlackActions = {
  disconnect: () => runApp(disconnect),
};

function refreshWhenVisible() {
  if (document.visibilityState === 'visible') void refreshSlack();
}

export function useSlack() {
  const current = React.useSyncExternalStore(signal.subscribe, selectSlack);
  React.useEffect(() => {
    void refreshSlack();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);
  return current;
}

export function useSlackDirectory(teamId: string | null) {
  const [directory, setDirectory] = React.useState<SlackDirectoryView | null>(null);
  useAppEffect(
    () =>
      Effect.gen(function* () {
        setDirectory(null);
        if (!teamId) return;
        const engine = yield* EngineClient;
        const found = yield* engine.slack.directory({ query: { teamId } });
        setDirectory(found);
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() =>
            setDirectory({ teamId: teamId ?? '', channels: [], people: [], problem: error.message })
          )
        )
      ),
    [teamId]
  );
  return directory;
}
