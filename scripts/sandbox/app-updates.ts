import { Effect, Ref, Schedule } from 'effect';
import { AppUpdates } from '../../apps/engine/src/app-updates/service.ts';
import type {
  AppUpdate,
  AppUpdateReport,
  AppUpdateRequest,
} from '../../packages/core/src/engine-api/schema.ts';
import { ENGINE_PROTOCOL } from '../../packages/core/src/index.ts';
import {
  PREVIEW_APP_PATH,
  PREVIEW_APP_RELAUNCH_TICKS,
  PREVIEW_APP_REPORT,
  PREVIEW_ENGINE_VERSION,
  type PreviewApp,
} from './schema.ts';

export interface PreviewAppState {
  report: AppUpdateReport;
  quiet: number;
}

function resolveFound(app: PreviewApp, version: string): AppUpdate {
  return app.latest && app.latest !== version
    ? { status: 'ready', version: app.latest }
    : { status: 'current' };
}

export function createPreviewAppState(app: PreviewApp): PreviewAppState {
  return {
    report: {
      version: app.version,
      protocol: ENGINE_PROTOCOL,
      channel: app.channel,
      update: resolveFound(app, app.version),
    },
    quiet: 0,
  };
}

export function applyPreviewAppRequest(
  app: PreviewApp,
  state: PreviewAppState,
  request: AppUpdateRequest
): PreviewAppState {
  const { report } = state;
  switch (request.kind) {
    case 'check':
      return { ...state, report: { ...report, update: resolveFound(app, report.version) } };
    case 'install':
      return report.update.status === 'ready'
        ? {
            report: { ...report, update: { status: 'installing', version: report.update.version } },
            quiet: PREVIEW_APP_RELAUNCH_TICKS,
          }
        : state;
    case 'channel':
      return {
        ...state,
        report: { ...report, channel: request.channel, update: resolveFound(app, report.version) },
      };
    case 'downgrade':
      return { ...state, report: { ...report, update: { status: 'current' } } };
  }
}

export function resolvePreviewRelaunch(state: PreviewAppState): PreviewAppState {
  if (state.quiet > 1) return { ...state, quiet: state.quiet - 1 };
  const { update } = state.report;
  const version = update.status === 'installing' ? update.version : state.report.version;
  return { report: { ...state.report, version, update: { status: 'current' } }, quiet: 0 };
}

export const createPreviewAppUpdates = Effect.fn('Sandbox.createPreviewAppUpdates')(function* (
  app: PreviewApp | undefined
) {
  return yield* Effect.gen(function* () {
    return yield* AppUpdates;
  }).pipe(
    Effect.provide(
      AppUpdates.layer({
        app: app ? PREVIEW_APP_PATH : null,
        engine: { version: PREVIEW_ENGINE_VERSION, protocol: ENGINE_PROTOCOL },
        open: () => Effect.void,
      })
    )
  );
});

export const runPreviewApp = Effect.fn('Sandbox.runPreviewApp')(function* (
  appUpdates: AppUpdates['Service'],
  app: PreviewApp
) {
  const state = yield* Ref.make(createPreviewAppState(app));
  const report = Effect.gen(function* () {
    const current = yield* Ref.get(state);
    if (current.quiet > 0) return yield* Ref.set(state, resolvePreviewRelaunch(current));
    const { requests } = yield* appUpdates.report(current.report);
    if (requests.length === 0) return;
    const next = requests.reduce((latest, request) => applyPreviewAppRequest(app, latest, request), current);
    yield* Ref.set(state, next);
    yield* appUpdates.report(next.report);
  });
  return yield* Effect.repeat(report, Schedule.spaced(PREVIEW_APP_REPORT));
});
