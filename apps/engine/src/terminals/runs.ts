import { resolveTaskServiceCwd, type ServiceDefinition, type ShinsaState } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { resolveSharedCacheEnv } from '../checks/caches/paths.ts';
import { resolveServicePlaceIn } from './places.ts';
import type { ServiceMachine, ServiceRun } from './schema.ts';

export const selectServiceRunIn = Effect.fn('Terminals.selectServiceRunIn')(function* (
  state: ShinsaState,
  service: ServiceDefinition,
  taskId: string | null,
  machine: ServiceMachine
) {
  if (taskId === null) {
    const place = resolveServicePlaceIn(state, service, machine.home);
    if (!place) return Option.none<ServiceRun>();
    return Option.some<ServiceRun>({ cwd: service.cwd, place, taskId: null });
  }
  const task = state.tasks[taskId];
  if (!(task?.worktreePath && task.repoId)) return Option.none<ServiceRun>();
  const cwd = resolveTaskServiceCwd(state, service, task);
  if (cwd === null) return Option.none<ServiceRun>();
  const env = yield* resolveSharedCacheEnv(task.worktreePath, machine.dataDir, task.repoId);
  return Option.some<ServiceRun>({ cwd, place: 'worktree', taskId, env });
});
