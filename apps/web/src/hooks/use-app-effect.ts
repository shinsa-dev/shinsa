import { Effect, Fiber } from 'effect';
import * as React from 'react';
import { appRuntime } from '@/lib/runtime/app.ts';
import type { AppServices } from '@/lib/runtime/schema.ts';

export function useAppEffect<E>(
  create: () => Effect.Effect<unknown, E, AppServices>,
  deps: React.DependencyList
) {
  const latest = React.useRef(create);
  latest.current = create;
  React.useEffect(() => {
    const fiber = appRuntime.runFork(Effect.suspend(() => latest.current()));
    return () => {
      appRuntime.runFork(Fiber.interrupt(fiber));
    };
  }, deps);
}
