import type { ShinsaState, Task } from '@shinsa/core';
import type { QuickJson } from '../agents/quick/index.ts';
import type { LocalRepo } from '../repos/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { resolveQuickAsk } from './classify.ts';
import type { TriageResult } from './schema.ts';
import { requestTriage } from './task/service.ts';
import type { TeamReader } from './team.ts';

export { resolveRepoProject } from './repositories.ts';
export type { TriageResolver, TriageResult } from './schema.ts';

export function resolveTriage(
  state: ShinsaState,
  task: Task,
  local: LocalRepo[],
  ask: QuickJson,
  team: TeamReader | null = null
): Promise<TriageResult> {
  return edgeRuntime.runPromise(requestTriage({ state, task, local, ask: resolveQuickAsk(ask), team }));
}
