import { Option } from 'effect';
import type { Repo } from '../domain/types.ts';
import { type CoverageSetting, DEFAULT_COVERAGE, FORMAT_BY_EXTENSION } from './schema.ts';
import type { CoverageFormat } from './types.ts';

export function resolveRepoCoverage(repo: Pick<Repo, 'coverage'> | null | undefined): CoverageSetting {
  return repo?.coverage ?? { ...DEFAULT_COVERAGE };
}

export function resolveCoverageFormat(report: string): Option.Option<CoverageFormat> {
  return Option.fromNullishOr(FORMAT_BY_EXTENSION.find(([pattern]) => pattern.test(report.trim()))?.[1]);
}

export function resolveCustomFormat(setting: Extract<CoverageSetting, { mode: 'custom' }>) {
  return Option.orElse(Option.fromNullishOr(setting.format), () => resolveCoverageFormat(setting.report));
}
