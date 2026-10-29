import { APP_IDENTITY } from '@shinsa/core';

export interface ServerHealth {
  version: string | null;
  working: number;
}

function parseCount(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

export function parseHealth(value: unknown): ServerHealth | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ok, version, working } = value as Record<string, unknown>;
  if (typeof ok !== 'boolean') return null;
  return { version: typeof version === 'string' && version ? version : null, working: parseCount(working) };
}

export function parseHealthText(text: string) {
  try {
    return parseHealth(JSON.parse(text));
  } catch {
    return null;
  }
}

export function describeServer(url: string, health: ServerHealth | null) {
  const name = APP_IDENTITY.appName;
  return health?.version ? `${name} ${health.version} at ${url}` : `${name} at ${url}`;
}
