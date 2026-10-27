export const COVERAGE_MODES = ['auto', 'custom', 'off'] as const;

export type CoverageMode = (typeof COVERAGE_MODES)[number];

export const COVERAGE_FORMATS = ['lcov', 'cobertura', 'go'] as const;

export type CoverageFormat = (typeof COVERAGE_FORMATS)[number];

export type CoverageSetting =
  | { mode: 'auto' }
  | { mode: 'off' }
  | { mode: 'custom'; command: string; report: string; format: CoverageFormat | null };

export interface CoverageDetection {
  tool: string;
  command: string;
}

export type CoverageRange = [number, number];

export interface CoverageFile {
  path: string;
  covered: number;
  executable: number;
  uncovered: CoverageRange[];
}

export type Coverage =
  | {
      status: 'measured';
      command: string;
      covered: number;
      executable: number;
      files: CoverageFile[];
    }
  | { status: 'unavailable'; command: string; reason: string };

export type MeasuredCoverage = Extract<Coverage, { status: 'measured' }>;

export type CoverageHits = Map<string, Map<number, number>>;

export type ChangedLines = Map<string, number[]>;

export const COVERAGE_LIMITS = {
  command: 2000,
  report: 500,
  reason: 400,
  files: 100,
  ranges: 40,
  reviewFiles: 20,
  reviewRanges: 10,
} as const;
