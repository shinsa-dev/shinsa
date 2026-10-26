export interface ServerHealth {
  version: string | null;
}

export function parseHealth(value: unknown): ServerHealth | null {
  if (typeof value !== 'object' || value === null) return null;
  const { ok, version } = value as Record<string, unknown>;
  if (typeof ok !== 'boolean') return null;
  return { version: typeof version === 'string' && version ? version : null };
}

export function parseHealthText(text: string) {
  try {
    return parseHealth(JSON.parse(text));
  } catch {
    return null;
  }
}

export function describeServer(url: string, health: ServerHealth | null) {
  return health?.version ? `Shinsa ${health.version} at ${url}` : `Shinsa at ${url}`;
}
