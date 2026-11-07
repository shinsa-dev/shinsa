import type { CoverageDetection, Repo } from '@shinsa/core';
import { Effect, Option } from 'effect';
import { selectCoverageDetection } from './detect.ts';

export type { CoverageRequest } from './schema.ts';
export { TaskCoverage } from './service.ts';

export const listCoverageDetections = Effect.fn('CoverageDetection.list')(function* (
  repos: readonly Pick<Repo, 'id' | 'path'>[]
) {
  const detected: Record<string, CoverageDetection | null> = {};
  for (const repo of repos) detected[repo.id] = Option.getOrNull(yield* selectCoverageDetection(repo.path));
  return detected;
});
