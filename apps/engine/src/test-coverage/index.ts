import type { CoverageDetection, Repo } from '@shinsa/core';
import { resolveCoverageDetection } from './detect.ts';

export type { CoverageRequest } from './schema.ts';
export { TaskCoverage } from './service.ts';

export function listCoverageDetections(repos: readonly Pick<Repo, 'id' | 'path'>[]) {
  const detected: Record<string, CoverageDetection | null> = {};
  for (const repo of repos) detected[repo.id] = resolveCoverageDetection(repo.path);
  return detected;
}
