import { USER_COMMAND_TYPES, type UserCommand } from '../commands/index.ts';

export const ENGINE_PROTOCOL = 1;

export const DEVELOPMENT_VERSION = '0.0.0';

export const ENGINE_FEATURES = ['task.share', 'feedback', 'teams'] as const;

export type EngineFeature = (typeof ENGINE_FEATURES)[number];

export type EngineCommand = UserCommand['type'];

export const ENGINE_BASELINE_COMMANDS: readonly EngineCommand[] = [
  'repo.update',
  'repo.remove',
  'project.write',
  'project.remove',
  'focus.change',
  'settings.change',
  'task.create',
  'task.prioritize',
  'task.wait_on',
  'task.move_to_backlog',
  'task.remove_from_backlog',
  'task.snooze',
  'task.unsnooze',
  'task.cancel',
  'task.mark_duplicate',
  'task.clear_duplicate',
  'task.complete',
  'task.retry',
  'task.message',
  'round.ship',
  'round.update',
  'round.remove',
  'round.send',
  'gate.answer',
  'merge_step.tick',
  'suggestion.accept',
  'suggestion.dismiss',
  'suggestion.keep',
  'monitor.check_in_now',
  'run.snooze_silence',
  'run.dismiss_silence',
  'task.bind_account',
  'usage_wait.change',
  'usage_wait.resume_now',
  'delegation.cancel',
  'schedule.enable',
  'schedule.remove',
  'schedule.write',
  'watch_suggestion.accept',
  'watch_suggestion.dismiss',
  'watchdog.stop',
  'watchdog.connect',
  'watch_source.write',
  'watch_source.remove',
  'memory.write',
  'memory.accept',
  'memory.remove',
];

export interface EngineInfo {
  version: string;
  protocol: number;
  commands: string[];
  features: string[];
}

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

export function resolveEngineInfo(version: string): EngineInfo {
  return {
    version,
    protocol: ENGINE_PROTOCOL,
    commands: [...USER_COMMAND_TYPES],
    features: [...ENGINE_FEATURES],
  };
}

function readStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function parseEngineInfo(value: unknown): EngineInfo | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  if (typeof fields.protocol !== 'number' || !Number.isInteger(fields.protocol)) return null;
  return {
    version: typeof fields.version === 'string' ? fields.version : DEVELOPMENT_VERSION,
    protocol: fields.protocol,
    commands: readStrings(fields.commands),
    features: readStrings(fields.features),
  };
}

export function resolveEngineCommands(engine: EngineInfo | null): ReadonlySet<string> {
  return new Set<string>([...ENGINE_BASELINE_COMMANDS, ...(engine?.commands ?? [])]);
}

export function hasEngineFeature(engine: EngineInfo | null, feature: EngineFeature) {
  return engine?.features.includes(feature) ?? false;
}

export function isEngineProtocolMatch(engine: EngineInfo | null) {
  return engine === null || engine.protocol === ENGINE_PROTOCOL;
}
