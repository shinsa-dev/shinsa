import type { SlackSnapshot } from '@shinsa/core';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson } from '@/lib/connection/http.ts';
import { createSignal } from '@/lib/signal.ts';

interface SlackView {
  snapshot: SlackSnapshot | null;
  failure: string | null;
}

const signal = createSignal();

const EMPTY: SlackView = { snapshot: null, failure: null };

let view: SlackView = EMPTY;

let pending: Promise<void> | null = null;

function publish(next: SlackView) {
  view = next;
  signal.publish();
}

export function selectSlack() {
  return view;
}

export function resetSlack() {
  pending = null;
  publish(EMPTY);
}

export function refreshSlack() {
  pending ??= requestJson<SlackSnapshot>('/api/slack')
    .then(
      (snapshot) => publish({ snapshot, failure: null }),
      (error: unknown) => publish({ ...view, failure: describeFailure(error) })
    )
    .then(() => {
      pending = null;
    });
  return pending;
}

export interface SlackActions {
  disconnect: () => Promise<unknown>;
}

export const SLACK_ACTIONS: SlackActions = {
  disconnect: async () => {
    const snapshot = await requestJson<SlackSnapshot>('/api/slack/disconnect', {});
    publish({ snapshot, failure: null });
    return snapshot;
  },
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
