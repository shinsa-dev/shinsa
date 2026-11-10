import { Result } from 'effect';
import { APP_ENGINE_TARGET, ENGINE_TARGETS, type EngineTarget, EngineTargetUnknown } from './schema.ts';

export function resolveBuildTarget(
  requested: string | undefined
): Result.Result<EngineTarget, EngineTargetUnknown> {
  if (!requested) return Result.succeed(APP_ENGINE_TARGET);
  const target = ENGINE_TARGETS.find((known) => known === requested);
  if (target) return Result.succeed(target);
  return Result.fail(
    new EngineTargetUnknown({
      target: requested,
      message: `Unknown engine target ${requested}: use one of ${ENGINE_TARGETS.join(', ')}`,
    })
  );
}

export function resolveBuildFolder(target: EngineTarget) {
  return target === APP_ENGINE_TARGET ? 'engine' : `engine-${target.replace(/^bun-/, '')}`;
}
