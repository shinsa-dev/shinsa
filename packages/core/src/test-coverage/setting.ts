import type { Repo } from '../domain/types.ts';
import type { CoverageFormat, CoverageSetting } from './types.ts';

const FORMAT_BY_EXTENSION: [RegExp, CoverageFormat][] = [
  [/(^|[/\\])lcov[^/\\]*$|\.(info|lcov)$/i, 'lcov'],
  [/\.xml$/i, 'cobertura'],
  [/\.(out|coverprofile)$/i, 'go'],
];

export const DEFAULT_COVERAGE: CoverageSetting = { mode: 'auto' };

export function resolveRepoCoverage(repo: Pick<Repo, 'coverage'> | null | undefined): CoverageSetting {
  return repo?.coverage ?? { ...DEFAULT_COVERAGE };
}

export function resolveCoverageFormat(report: string): CoverageFormat | null {
  return FORMAT_BY_EXTENSION.find(([pattern]) => pattern.test(report.trim()))?.[1] ?? null;
}

export function resolveCustomFormat(setting: Extract<CoverageSetting, { mode: 'custom' }>) {
  return setting.format ?? resolveCoverageFormat(setting.report);
}
