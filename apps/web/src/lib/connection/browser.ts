import type {
  BrowserCopyAnswer,
  BrowserProjectAnswer,
  BrowserSite,
  SourceBrowserAnswer,
  SourceBrowserId,
} from '@shinsa/core/engine-api/schema';
import { Effect } from 'effect';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';

const readProject = Effect.fn('Browser.readProject')(function* (projectId: string) {
  const engine = yield* EngineClient;
  return yield* engine.browser.project({ params: { projectId } });
});

const readSources = Effect.gen(function* () {
  const engine = yield* EngineClient;
  return (yield* engine.browser.sources()).sources;
});

const readSourceSites = Effect.fn('Browser.readSourceSites')(function* (sourceId: SourceBrowserId) {
  const engine = yield* EngineClient;
  return (yield* engine.browser.sourceSites({ params: { sourceId } })).sites;
});

const writeCopy = Effect.fn('Browser.writeCopy')(function* (
  projectId: string,
  source: SourceBrowserId,
  sites: ReadonlyArray<string>
) {
  const engine = yield* EngineClient;
  return yield* engine.browser.copy({ params: { projectId }, payload: { source, sites: [...sites] } });
});

const writeOpenWindow = Effect.fn('Browser.writeOpenWindow')(function* (
  projectId: string,
  url: string | null
) {
  const engine = yield* EngineClient;
  return yield* engine.browser.openWindow({ params: { projectId }, payload: { url } });
});

const writeCloseWindow = Effect.fn('Browser.writeCloseWindow')(function* (projectId: string) {
  const engine = yield* EngineClient;
  return yield* engine.browser.closeWindow({ params: { projectId }, payload: {} });
});

const writeSignOut = Effect.fn('Browser.writeSignOut')(function* (projectId: string) {
  const engine = yield* EngineClient;
  return yield* engine.browser.signOut({ params: { projectId }, payload: {} });
});

export function requestBrowserProject(projectId: string): Promise<BrowserProjectAnswer> {
  return runApp(readProject(projectId));
}

export function requestBrowserSources(): Promise<ReadonlyArray<SourceBrowserAnswer>> {
  return runApp(readSources);
}

export function requestSourceSites(sourceId: SourceBrowserId): Promise<ReadonlyArray<BrowserSite>> {
  return runApp(readSourceSites(sourceId));
}

export function requestBrowserCopy(
  projectId: string,
  source: SourceBrowserId,
  sites: ReadonlyArray<string>
): Promise<BrowserCopyAnswer> {
  return runApp(writeCopy(projectId, source, sites));
}

export function requestSignInWindow(projectId: string, url: string | null): Promise<BrowserProjectAnswer> {
  return runApp(writeOpenWindow(projectId, url));
}

export function requestSignInWindowClose(projectId: string): Promise<BrowserProjectAnswer> {
  return runApp(writeCloseWindow(projectId));
}

export function requestBrowserSignOut(projectId: string): Promise<BrowserProjectAnswer> {
  return runApp(writeSignOut(projectId));
}

export interface BrowserActions {
  readProject: typeof requestBrowserProject;
  listSources: typeof requestBrowserSources;
  listSourceSites: typeof requestSourceSites;
  copy: typeof requestBrowserCopy;
  openWindow: typeof requestSignInWindow;
  closeWindow: typeof requestSignInWindowClose;
  signOut: typeof requestBrowserSignOut;
}

export const BROWSER_ACTIONS: BrowserActions = {
  readProject: requestBrowserProject,
  listSources: requestBrowserSources,
  listSourceSites: requestSourceSites,
  copy: requestBrowserCopy,
  openWindow: requestSignInWindow,
  closeWindow: requestSignInWindowClose,
  signOut: requestBrowserSignOut,
};
