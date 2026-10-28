import type { AppFlavor } from '@shinsa/core';
import { FLAVOR } from './flavor.ts';

export interface ServerHealth {
  version: string | null;
}

export function parseHealth(value: unknown, flavor: AppFlavor = FLAVOR.flavor): ServerHealth | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ok, version, flavor: served = 'stable' } = value as Record<string, unknown>;
  if (typeof ok !== 'boolean' || served !== flavor) return null;
  return { version: typeof version === 'string' && version ? version : null };
}

export function parseHealthText(text: string, flavor: AppFlavor = FLAVOR.flavor) {
  try {
    return parseHealth(JSON.parse(text), flavor);
  } catch {
    return null;
  }
}

export function describeServer(url: string, health: ServerHealth | null, name = FLAVOR.appName) {
  return health?.version ? `${name} ${health.version} at ${url}` : `${name} at ${url}`;
}
