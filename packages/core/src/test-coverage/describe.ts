import { COVERAGE_LIMITS, type Coverage, type CoverageRange, type MeasuredCoverage } from './types.ts';

export function selectMeasuredCoverage(coverage: Coverage | null | undefined): MeasuredCoverage | null {
  if (coverage?.status !== 'measured' || coverage.executable === 0) return null;
  return coverage;
}

export function formatCoveragePercent(covered: number, executable: number) {
  if (covered >= executable) return '100%';
  if (covered <= 0) return '0%';
  return `${Math.min(99, Math.max(1, Math.floor((covered / executable) * 100)))}%`;
}

export function describeCoverage(coverage: Coverage | null | undefined) {
  const measured = selectMeasuredCoverage(coverage);
  if (!measured) return null;
  const { covered, executable } = measured;
  if (covered === executable) {
    return executable === 1 ? 'The changed line is covered' : `All ${executable} changed lines are covered`;
  }
  if (covered === 0) {
    return executable === 1
      ? 'The changed line is not covered'
      : `None of the ${executable} changed lines are covered`;
  }
  return `${formatCoveragePercent(covered, executable)} of changed lines are covered (${covered} of ${executable})`;
}

export function describeCoverageRange([start, end]: CoverageRange) {
  return start === end ? `${start}` : `${start}-${end}`;
}

export function listCoverageGaps(coverage: Coverage | null | undefined) {
  const measured = selectMeasuredCoverage(coverage);
  if (!measured) return [];
  return measured.files
    .filter((file) => file.covered < file.executable)
    .slice(0, COVERAGE_LIMITS.reviewFiles)
    .map((file) => {
      const shown = file.uncovered.slice(0, COVERAGE_LIMITS.reviewRanges).map(describeCoverageRange);
      const more = file.uncovered.length > shown.length ? ', …' : '';
      return `${file.path}: ${file.covered} of ${file.executable} changed lines covered; not covered: ${shown.join(', ')}${more}`;
    });
}
