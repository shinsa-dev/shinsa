export const ENGINE_TARGETS = [
  'bun-darwin-arm64',
  'bun-darwin-x64',
  'bun-linux-x64',
  'bun-linux-arm64',
] as const;

export type EngineTarget = (typeof ENGINE_TARGETS)[number];

export const APP_ENGINE_TARGET: EngineTarget = 'bun-darwin-arm64';

export function resolveBuildTarget(requested: string | undefined): EngineTarget {
  if (!requested) return APP_ENGINE_TARGET;
  const target = ENGINE_TARGETS.find((known) => known === requested);
  if (!target) throw new Error(`Unknown engine target ${requested}: use one of ${ENGINE_TARGETS.join(', ')}`);
  return target;
}

export function resolveBuildFolder(target: EngineTarget) {
  return target === APP_ENGINE_TARGET ? 'engine' : `engine-${target.replace(/^bun-/, '')}`;
}
