import { resolveEngineFit, type ShinsaBuild } from '@shinsa/core';
import type { AppUpdateReport, AppUpdateRequest, AppUpdatesAnswer } from '@shinsa/core/engine-api/schema';
import { Duration } from 'effect';
import {
  APP_BUNDLE_MARKER,
  APP_INSTALL_WINDOW,
  APP_REPORT_FRESH,
  type AppInstall,
  type AppUpdatesControl,
  type InstallProgress,
} from './schema.ts';

export function resolveCarryingApp(program: string): string | null {
  const at = program.indexOf(APP_BUNDLE_MARKER);
  return at === -1 ? null : program.slice(0, at + '.app'.length);
}

export function isReportFresh(control: AppUpdatesControl, now: number) {
  return control.reportedAt !== null && now - control.reportedAt <= Duration.toMillis(APP_REPORT_FRESH);
}

export function resolveQueuedRequests(
  queued: readonly AppUpdateRequest[],
  request: AppUpdateRequest
): readonly AppUpdateRequest[] {
  return [...queued.filter((waiting) => waiting.kind !== request.kind), request];
}

export function resolveInstallProgress(
  install: AppInstall,
  report: AppUpdateReport,
  engine: ShinsaBuild,
  now: number
): InstallProgress {
  if (report.version !== install.from) {
    return resolveEngineFit(report, engine).kind === 'restart_engine' ? 'restart_engine' : 'installed';
  }
  if (now - install.requestedAt > Duration.toMillis(APP_INSTALL_WINDOW)) return 'abandoned';
  if (report.update.status === 'failed') return 'abandoned';
  const waiting = report.update.status === 'ready' || report.update.status === 'installing';
  return install.handed && !waiting ? 'abandoned' : 'waiting';
}

export function resolveAppUpdatesView(
  control: AppUpdatesControl,
  app: string | null,
  engine: ShinsaBuild,
  now: number
): AppUpdatesAnswer {
  const fresh = isReportFresh(control, now);
  const installing =
    control.install && now - control.install.requestedAt <= Duration.toMillis(APP_INSTALL_WINDOW)
      ? control.install.to
      : null;
  return {
    source: app !== null || control.report !== null ? 'app' : 'standalone',
    running: fresh,
    app: control.report,
    installing,
    engine: { version: engine.version, protocol: engine.protocol },
  };
}
