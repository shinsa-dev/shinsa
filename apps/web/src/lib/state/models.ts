import { type AgentModel, KNOWN_AGENT_MODELS } from '@shinsa/core';
import * as React from 'react';

let latest: AgentModel[] = KNOWN_AGENT_MODELS;
let request: Promise<AgentModel[]> | null = null;

async function readModels() {
  const response = await fetch('/api/models');
  if (!response.ok) throw new Error(`The model list failed with status ${response.status}.`);
  return (await response.json()) as AgentModel[];
}

export function requestModels() {
  request ??= readModels().then(
    (models) => {
      latest = models;
      return models;
    },
    () => {
      request = null;
      return latest;
    }
  );
  return request;
}

export function useAgentModels() {
  const [models, setModels] = React.useState<AgentModel[]>(latest);
  React.useEffect(() => {
    let live = true;
    void requestModels().then((next) => {
      if (live) setModels(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return models;
}
