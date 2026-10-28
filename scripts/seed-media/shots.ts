import { join } from 'node:path';

export type ShotTheme = 'light' | 'dark';

export type ShotOutput = 'seed' | 'samples';

export type ShotSource =
  | { fixture: 'settings' | 'tabs'; query: Record<string, string>; centreActive?: boolean }
  | { app: string; keys?: string };

export type RecordingStep =
  | { kind: 'wait'; ms: number }
  | { kind: 'wheel'; selector: string; deltaX: number; times: number; gapMs: number }
  | { kind: 'click'; text: string };

export interface SeedShot {
  file: string;
  output: ShotOutput;
  source: ShotSource;
  width: number;
  height: number;
  theme: ShotTheme;
  steps?: readonly RecordingStep[];
}

export interface RecordedFrame {
  path: string;
  at: number;
}

const TABS_TOUR: readonly RecordingStep[] = [
  { kind: 'wait', ms: 800 },
  { kind: 'wheel', selector: '#tabs', deltaX: 60, times: 8, gapMs: 120 },
  { kind: 'wait', ms: 500 },
  { kind: 'wheel', selector: '#tabs', deltaX: -60, times: 8, gapMs: 120 },
  { kind: 'wait', ms: 500 },
  { kind: 'click', text: 'Win-back offer' },
  { kind: 'wait', ms: 1200 },
  { kind: 'click', text: 'Family plan' },
  { kind: 'wait', ms: 1200 },
  { kind: 'click', text: 'Welcome' },
  { kind: 'wait', ms: 1200 },
];

function settings(mode: string) {
  return { fixture: 'settings' as const, query: { mode } };
}

function tabs(mode: string, theme: ShotTheme, active?: string) {
  return {
    fixture: 'tabs' as const,
    query: { mode, theme, ...(active ? { active } : {}) },
    ...(active ? { centreActive: true } : {}),
  };
}

type ShotSpec = Omit<SeedShot, 'output'>;

const SEED_MEDIA: readonly ShotSpec[] = [
  {
    file: 'settings-1280-dark-before.png',
    source: settings('dark before'),
    width: 1280,
    height: 800,
    theme: 'dark',
  },
  {
    file: 'settings-1280-dark-after.png',
    source: settings('dark after'),
    width: 1280,
    height: 800,
    theme: 'dark',
  },
  {
    file: 'settings-390-dark-before.png',
    source: settings('dark before'),
    width: 390,
    height: 844,
    theme: 'dark',
  },
  {
    file: 'settings-390-dark-after.png',
    source: settings('dark after'),
    width: 390,
    height: 844,
    theme: 'dark',
  },
  {
    file: 'settings-1280-light-after.png',
    source: settings('light'),
    width: 1280,
    height: 800,
    theme: 'light',
  },
  {
    file: 'settings-1280-dark-revised.png',
    source: settings('dark fixed'),
    width: 1280,
    height: 800,
    theme: 'dark',
  },
  {
    file: 'disabled-1280-dark-before.png',
    source: settings('dark after'),
    width: 1280,
    height: 800,
    theme: 'dark',
  },
  {
    file: 'disabled-1280-dark-after.png',
    source: settings('dark fixed'),
    width: 1280,
    height: 800,
    theme: 'dark',
  },
  {
    file: 'tabs-1280-light-before.png',
    source: tabs('before', 'light'),
    width: 1280,
    height: 720,
    theme: 'light',
  },
  {
    file: 'tabs-1280-light-after.png',
    source: tabs('after', 'light'),
    width: 1280,
    height: 720,
    theme: 'light',
  },
  {
    file: 'tabs-390-light-after.png',
    source: tabs('after', 'light', 'Win-back offer'),
    width: 390,
    height: 760,
    theme: 'light',
  },
  {
    file: 'tabs-900-dark-after.png',
    source: tabs('after', 'dark', 'Exit survey'),
    width: 900,
    height: 720,
    theme: 'dark',
  },
  {
    file: 'tabs-scroll-1280-light.webm',
    source: tabs('after', 'light'),
    width: 1280,
    height: 720,
    theme: 'light',
    steps: TABS_TOUR,
  },
  {
    file: 'review-spots-1280-light-after.png',
    source: { app: '/tasks/task-sample-review?tab=review', keys: 'jjjjjjjjj' },
    width: 1280,
    height: 800,
    theme: 'light',
  },
  {
    file: 'review-spots-1280-dark-after.png',
    source: { app: '/tasks/task-sample-review?tab=review', keys: 'jjjjjjjjj' },
    width: 1280,
    height: 800,
    theme: 'dark',
  },
];

const WEB_SAMPLES: readonly ShotSpec[] = [
  {
    file: 'settings-dark-before.png',
    source: settings('dark before'),
    width: 800,
    height: 500,
    theme: 'dark',
  },
  { file: 'settings-dark-after.png', source: settings('dark after'), width: 800, height: 500, theme: 'dark' },
  {
    file: 'tabs-scroll.webm',
    source: tabs('after', 'light'),
    width: 800,
    height: 500,
    theme: 'light',
    steps: TABS_TOUR,
  },
];

export const SEED_SHOTS: readonly SeedShot[] = [
  ...SEED_MEDIA.map((shot): SeedShot => ({ ...shot, output: 'seed' })),
  ...WEB_SAMPLES.map((shot): SeedShot => ({ ...shot, output: 'samples' })),
];

export const OUTPUT_DIRS: Record<ShotOutput, string> = {
  seed: 'scripts/seed-media',
  samples: 'apps/web/public/samples/evidence',
};

export function resolveShotPath(root: string, shot: SeedShot) {
  return join(root, OUTPUT_DIRS[shot.output], shot.file);
}

export function resolveShotUrl(shot: SeedShot, fixtures: string, origin: string | null) {
  const { source } = shot;
  if ('app' in source) {
    if (!origin) return null;
    return new URL(source.app, origin).href;
  }
  return `file://${join(fixtures, `${source.fixture}.html`)}?${new URLSearchParams(source.query)}`;
}

export function listShotFiles(output: ShotOutput) {
  return SEED_SHOTS.filter((shot) => shot.output === output)
    .map((shot) => shot.file)
    .sort();
}

export function serializeFrameList(frames: readonly RecordedFrame[], end: number) {
  const last = frames.at(-1);
  if (!last) throw new Error('The recording has no frames.');
  const lines = frames.flatMap((frame, index) => {
    const next = frames[index + 1]?.at ?? Math.max(end, frame.at);
    return [`file '${frame.path}'`, `duration ${(next - frame.at).toFixed(3)}`];
  });
  return [...lines, `file '${last.path}'`, ''].join('\n');
}
