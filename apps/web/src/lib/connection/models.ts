import { type AgentProviderInfo, KNOWN_AGENT_PROVIDERS } from '@shinsa/core';
import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';

let latest: AgentProviderInfo[] = KNOWN_AGENT_PROVIDERS;

let loaded = false;

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    latest = [...(yield* engine.server.providers())];
    loaded = true;
  }).pipe(Effect.ignore)
);

export function resetAgentProviders() {
  latest = KNOWN_AGENT_PROVIDERS;
  loaded = false;
  read.reset();
}

export function useAgentProviders() {
  const [providers, setProviders] = React.useState(latest);
  useAppEffect(
    () =>
      Effect.andThen(
        loaded ? Effect.void : Effect.promise(() => read.run()),
        Effect.sync(() => setProviders(latest))
      ),
    []
  );
  return providers;
}
