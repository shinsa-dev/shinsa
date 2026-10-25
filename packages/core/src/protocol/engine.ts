export const ENGINE_PROTOCOL = 1;

export const DEVELOPMENT_VERSION = '0.0.0';

export interface ShinsaBuild {
  version: string;
  protocol: number;
}

export type EngineFit =
  | { kind: 'match' }
  | { kind: 'restart_engine'; required: boolean }
  | { kind: 'update_app'; required: boolean };

export type EngineRestartWhen = 'now' | 'idle';

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

function parseVersion(version: string) {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function resolveVersionOrder(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference < 0 ? -1 : 1;
  }
  return 0;
}

export function resolveEngineFit(app: ShinsaBuild, engine: ShinsaBuild): EngineFit {
  if (engine.protocol > app.protocol) return { kind: 'update_app', required: true };
  if (engine.protocol < app.protocol) return { kind: 'restart_engine', required: true };
  if (app.version === DEVELOPMENT_VERSION || engine.version === DEVELOPMENT_VERSION) return { kind: 'match' };
  const order = resolveVersionOrder(engine.version, app.version);
  if (order === -1) return { kind: 'restart_engine', required: false };
  if (order === 1) return { kind: 'update_app', required: false };
  return { kind: 'match' };
}
