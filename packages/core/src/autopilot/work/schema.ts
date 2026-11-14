const AUTOPILOT_WORK_SURFACES = ['ui', 'logic', 'mixed', 'docs'] as const;

export type AutopilotWorkSurface = (typeof AUTOPILOT_WORK_SURFACES)[number];

const AUTOPILOT_WORK_NOVELTIES = ['new', 'tweak'] as const;

export type AutopilotWorkNovelty = (typeof AUTOPILOT_WORK_NOVELTIES)[number];

const AUTOPILOT_WORK_SIZES = ['small', 'medium', 'large'] as const;

export type AutopilotWorkSize = (typeof AUTOPILOT_WORK_SIZES)[number];

export interface AutopilotWorkFacts {
  area: string | null;
  surface: AutopilotWorkSurface | null;
  novelty: AutopilotWorkNovelty | null;
  size: AutopilotWorkSize | null;
  terms: number[];
}

export const AUTOPILOT_WORK_LIMITS = {
  termBuckets: 1024,
  terms: 32,
  requestCharacters: 1200,
  shortestTerm: 3,
  uiShare: 2 / 3,
  small: { phases: 2, files: 4 },
  large: { phases: 5, files: 12 },
} as const;
