import { Effect } from 'effect';
import * as React from 'react';
import { forkApp } from '@/lib/runtime/app.ts';
import type { AppServices } from '@/lib/runtime/schema.ts';

export function useAppEffect<E>(
  create: () => Effect.Effect<unknown, E, AppServices>,
  deps: React.DependencyList
) {
  const latest = React.useRef(create);
  latest.current = create;
  React.useEffect(() => {
    const fiber = forkApp(Effect.suspend(() => latest.current()));
    return () => {
      fiber.interruptUnsafe();
    };
  }, deps);
}
