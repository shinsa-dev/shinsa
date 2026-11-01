import * as React from 'react';

export const SPOTLIGHT_HOLD_MS = 1500;

export const SPOTLIGHT_FADE_MS = 600;

export type ReviewSelection = {
  readCurrent: () => string | null;
  readLit: () => string | null;
  readRequest: () => number;
  writeCurrent: (key: string | null) => void;
  light: (key: string | null) => void;
  request: () => void;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
  holding: boolean;
};

export function createReviewSelection(spot: string | null): ReviewSelection {
  const listeners = new Set<() => void>();
  let current = spot;
  let lit = spot;
  let requests = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const writeLit = (key: string | null) => {
    if (key === lit) return;
    lit = key;
    notify();
  };
  return {
    holding: false,
    readCurrent: () => current,
    readLit: () => lit,
    readRequest: () => requests,
    writeCurrent: (key) => {
      if (key === current) return;
      current = key;
      notify();
    },
    light: (key) => {
      clearTimer();
      writeLit(key);
      if (key) timer = setTimeout(() => writeLit(null), SPOTLIGHT_HOLD_MS);
    },
    request: () => {
      requests += 1;
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: clearTimer,
  };
}

export function useReviewSelection(spot: string | null) {
  const [selection] = React.useState(() => createReviewSelection(spot));
  React.useEffect(() => selection.dispose, [selection]);
  return selection;
}

export function useCurrentStop(selection: ReviewSelection) {
  return React.useSyncExternalStore(selection.subscribe, selection.readCurrent);
}

export function useStopLit(selection: ReviewSelection, key: string) {
  return React.useSyncExternalStore(selection.subscribe, () => selection.readLit() === key);
}

export function useSelectionRequest(selection: ReviewSelection) {
  return React.useSyncExternalStore(selection.subscribe, selection.readRequest);
}
