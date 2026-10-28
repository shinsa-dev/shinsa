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

export type ReleaseChannel = 'stable' | 'beta' | 'canary';

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

const NUMERIC = /^\d+$/;

interface ParsedVersion {
  release: number[];
  prerelease: string[];
}

function parseVersion(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  return {
    release: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareNumbers(a: number, b: number): -1 | 0 | 1 {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareIdentifiers(a: string, b: string): -1 | 0 | 1 {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return compareNumbers(Number(a), Number(b));
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function comparePrerelease(left: string[], right: string[]): -1 | 0 | 1 {
  if (left.length === 0 || right.length === 0) return compareNumbers(right.length, left.length);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const a = left[index];
    const b = right[index];
    if (a === undefined || b === undefined) return a === undefined ? -1 : 1;
    const order = compareIdentifiers(a, b);
    if (order !== 0) return order;
  }
  return 0;
}

export function isPrereleaseVersion(version: string) {
  return (parseVersion(version)?.prerelease.length ?? 0) > 0;
}

export function resolveReleaseChannel(version: string): ReleaseChannel {
  const [identifier] = parseVersion(version)?.prerelease ?? [];
  if (identifier === undefined) return 'stable';
  return identifier === 'canary' ? 'canary' : 'beta';
}

export function resolveVersionOrder(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index++) {
    const order = compareNumbers(left.release[index] ?? 0, right.release[index] ?? 0);
    if (order !== 0) return order;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
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
