import type { CoverageDetection } from '@shinsa/core';
import * as React from 'react';
import { requestJson } from '@/lib/connection/http.ts';
import { createSignal } from '@/lib/signal.ts';

export type CoverageDetectionMap = Record<string, CoverageDetection | null>;

const signal = createSignal();

let detected: CoverageDetectionMap | null = null;

let pending: Promise<void> | null = null;

function publish(next: CoverageDetectionMap) {
  detected = next;
  signal.publish();
}

export function selectCoverageDetection() {
  return detected;
}

export function resetCoverageDetection() {
  pending = null;
  detected = null;
  signal.publish();
}

export function refreshCoverageDetection() {
  pending ??= requestJson<{ detected?: CoverageDetectionMap }>('/api/repos/coverage')
    .then(
      (answer) => publish(answer.detected ?? {}),
      () => publish({})
    )
    .then(() => {
      pending = null;
    });
  return pending;
}

export function useCoverageDetection(repoKey: string) {
  React.useEffect(() => {
    if (repoKey) void refreshCoverageDetection();
  }, [repoKey]);
  return React.useSyncExternalStore(signal.subscribe, selectCoverageDetection);
}
