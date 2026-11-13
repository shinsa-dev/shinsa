import { type AgentProviderInfo, KNOWN_AGENT_PROVIDERS } from '@shinsa/core';
import { Effect } from 'effect';
import * as React from 'react';
import { useAppEffect } from '@/hooks/use-app-effect.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';

let latest: AgentProviderInfo[] = KNOWN_AGENT_PROVIDERS;
let readFor: string | null = null;

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    latest = [...(yield* engine.server.providers())];
  }).pipe(Effect.ignore)
);

export function resetAgentProviders() {
  latest = KNOWN_AGENT_PROVIDERS;
  readFor = null;
  read.reset();
}

export function useAgentProviders() {
  const [providers, setProviders] = React.useState(latest);
  const shown =
    useAccounts()
      ?.providers?.map((login) => login.provider)
      .join(',') ?? '';
  useAppEffect(
    () =>
      Effect.sync(() => {
        if (readFor !== null && readFor !== shown) read.reset();
        readFor = shown;
      }).pipe(
        Effect.andThen(Effect.promise(() => read.run())),
        Effect.andThen(Effect.sync(() => setProviders(latest)))
      ),
    [shown]
  );
  return providers;
}
