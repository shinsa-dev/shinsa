import type { AppUpdateReport, AppUpdatesAnswer } from '@shinsa/core/engine-api/schema';

export function createAppReport(overrides: Partial<AppUpdateReport> = {}): AppUpdateReport {
  return { version: '1.4.0', protocol: 1, channel: 'stable', update: { status: 'current' }, ...overrides };
}

export function createAppUpdatesAnswer(overrides: Partial<AppUpdatesAnswer> = {}): AppUpdatesAnswer {
  return {
    source: 'app',
    running: true,
    app: createAppReport(),
    installing: null,
    engine: { version: '1.4.0', protocol: 1 },
    ...overrides,
  };
}
