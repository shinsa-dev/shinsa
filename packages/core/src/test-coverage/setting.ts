import type { Repo } from '../domain/types.ts';
import { type CoverageSetting, DEFAULT_COVERAGE, FORMAT_BY_EXTENSION } from './schema.ts';
import type { CoverageFormat } from './types.ts';

export function resolveRepoCoverage(repo: Pick<Repo, 'coverage'> | null | undefined): CoverageSetting {
  return repo?.coverage ?? { ...DEFAULT_COVERAGE };
}

export function resolveCoverageFormat(report: string): CoverageFormat | null {
  return FORMAT_BY_EXTENSION.find(([pattern]) => pattern.test(report.trim()))?.[1] ?? null;
}

export function resolveCustomFormat(setting: Extract<CoverageSetting, { mode: 'custom' }>) {
  return setting.format ?? resolveCoverageFormat(setting.report);
}
