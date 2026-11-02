import type { CoverageDetection } from '@shinsa/core';
import { Effect } from 'effect';
import * as React from 'react';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';
import { createSignal } from '@/lib/signal.ts';

export type CoverageDetectionMap = Record<string, CoverageDetection | null>;

const signal = createSignal();

let detected: CoverageDetectionMap | null = null;

function publish(next: CoverageDetectionMap) {
  detected = next;
  signal.publish();
}

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    const answer = yield* engine.projects.coverage();
    publish({ ...answer.detected });
  }).pipe(Effect.catch(() => Effect.sync(() => publish({}))))
);

export function selectCoverageDetection() {
  return detected;
}

export function resetCoverageDetection() {
  read.reset();
  detected = null;
  signal.publish();
}

export function refreshCoverageDetection() {
  return read.run();
}

export function useCoverageDetection(repoKey: string) {
  React.useEffect(() => {
    if (repoKey) void refreshCoverageDetection();
  }, [repoKey]);
  return React.useSyncExternalStore(signal.subscribe, selectCoverageDetection);
}
