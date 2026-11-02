import type { Coverage, CoverageDetection, Repo } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import { resolveCoverageDetection } from './detect.ts';
import type { CoverageRequest } from './schema.ts';
import { TaskCoverage } from './service.ts';

export type { CoverageRequest } from './schema.ts';

export function measureTaskCoverage(request: CoverageRequest): Promise<Coverage | null> {
  return edgeRuntime.runPromise(TaskCoverage.use((coverage) => coverage.measure(request)));
}

export function listCoverageDetections(repos: readonly Pick<Repo, 'id' | 'path'>[]) {
  const detected: Record<string, CoverageDetection | null> = {};
  for (const repo of repos) detected[repo.id] = resolveCoverageDetection(repo.path);
  return detected;
}
