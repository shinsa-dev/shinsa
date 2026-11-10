import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { runReported } from '@/lib/runtime/timers.ts';

export function useDelay(run: () => void, delayMs: number | null, deps: React.DependencyList = []) {
  const latest = React.useRef(run);
  latest.current = run;
  useAppEffect(() => {
    if (delayMs === null) return Effect.void;
    return Effect.delay(
      runReported(() => latest.current()),
      delayMs
    );
  }, [delayMs, ...deps]);
}
