import { type AgentProviderInfo, KNOWN_AGENT_PROVIDERS } from '@shinsa/core';
import * as React from 'react';
import { requestJson } from '@/lib/connection/http.ts';

let latest: AgentProviderInfo[] = KNOWN_AGENT_PROVIDERS;
let request: Promise<AgentProviderInfo[]> | null = null;

function requestProviders() {
  request ??= requestJson<AgentProviderInfo[]>('/api/providers').then(
    (providers) => {
      latest = providers;
      return providers;
    },
    () => {
      request = null;
      return latest;
    }
  );
  return request;
}

export function useAgentProviders() {
  const [providers, setProviders] = React.useState<AgentProviderInfo[]>(latest);
  React.useEffect(() => {
    let live = true;
    void requestProviders().then((next) => {
      if (live) setProviders(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return providers;
}
