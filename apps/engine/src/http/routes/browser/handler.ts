import { EngineApi } from '@shinsa/core/engine-api';
import {
  type BrowserProjectAnswer,
  RequestFailed,
  RouteNotFound,
  ROUTE_NOT_FOUND_MESSAGE,
  SourceBrowserId,
} from '@shinsa/core/engine-api/schema';
import { Effect, Option, Schema } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { BrowserCookies } from '../../../browser/cookies/service.ts';
import { BrowserProfile, SignInUrl } from '../../../browser/host/schema.ts';
import { BrowserHost } from '../../../browser/host/service.ts';
import { EngineCore } from '../../../runtime/engine/service.ts';
import {
  BROWSER_FAILED_CODE,
  KEYCHAIN_REFUSED_CODE,
  MAX_COPY_SITES,
  MAX_SITE_LENGTH,
  PROJECT_NOT_FOUND,
  SITE_INVALID,
  SITES_INVALID,
  SOURCE_INVALID,
  URL_INVALID,
} from './schema.ts';

export const BrowserHandlers = HttpApiBuilder.group(
  EngineApi,
  'browser',
  Effect.fn('BrowserHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const host = Option.getOrNull(yield* Effect.serviceOption(BrowserHost));
    const cookies = Option.getOrNull(yield* Effect.serviceOption(BrowserCookies));
    const decodeProfile = Schema.decodeUnknownOption(BrowserProfile);
    const decodeSource = Schema.decodeUnknownOption(SourceBrowserId);
    const decodeUrl = Schema.decodeUnknownOption(SignInUrl);
    const SiteName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SITE_LENGTH));
    const decodeSite = Schema.decodeUnknownOption(SiteName);
    const decodeSites = Schema.decodeUnknownOption(
      Schema.Array(SiteName).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_COPY_SITES))
    );

    const findBrowser = Effect.fromNullishOr(host && cookies ? { host, cookies } : null).pipe(
      Effect.mapError(() => new RouteNotFound({ message: ROUTE_NOT_FOUND_MESSAGE }))
    );

    const findProfile = Effect.fn('BrowserHandlers.findProfile')(function* (projectId: string) {
      const project = (yield* engine.state).projects[projectId];
      const profile = project ? Option.getOrNull(decodeProfile(project.id)) : null;
      if (!profile) return yield* new RequestFailed(PROJECT_NOT_FOUND);
      return profile;
    });

    const describeProject = Effect.fn('BrowserHandlers.describeProject')(function* (profile: BrowserProfile) {
      const browser = yield* findBrowser;
      const answer: BrowserProjectAnswer = {
        mode: yield* browser.host.resolveMode(profile),
        sites: yield* browser.cookies.listSites(profile),
      };
      return answer;
    });

    const readOrFail = <A>(decoded: Option.Option<A>, failure: { code: string; message: string }) =>
      Option.match(decoded, {
        onNone: () => Effect.fail(new RequestFailed(failure)),
        onSome: Effect.succeed,
      });

    const failBrowser = <A, R>(
      effect: Effect.Effect<
        A,
        | RequestFailed
        | RouteNotFound
        | { readonly _tag: 'BrowserUnavailable'; readonly reason: string; readonly message: string }
        | { readonly _tag: 'CookieSourceUnavailable'; readonly reason: string; readonly message: string }
        | { readonly _tag: 'KeychainRefused'; readonly message: string }
        | { readonly _tag: 'CdpFailed'; readonly message: string },
        R
      >
    ) =>
      effect.pipe(
        Effect.catchTags({
          BrowserUnavailable: (error) =>
            Effect.fail(new RequestFailed({ code: `browser_${error.reason}`, message: error.message })),
          CookieSourceUnavailable: (error) =>
            Effect.fail(
              new RequestFailed({ code: `browser_source_${error.reason}`, message: error.message })
            ),
          KeychainRefused: (error) =>
            Effect.fail(new RequestFailed({ code: KEYCHAIN_REFUSED_CODE, message: error.message })),
          CdpFailed: (error) =>
            Effect.fail(new RequestFailed({ code: BROWSER_FAILED_CODE, message: error.message })),
        })
      );

    return handlers
      .handle('project', ({ params }) => Effect.flatMap(findProfile(params.projectId), describeProject))
      .handle('sources', () =>
        Effect.flatMap(findBrowser, (browser) =>
          Effect.map(browser.cookies.listSources, (sources) => ({ sources }))
        )
      )
      .handle(
        'sourceSites',
        Effect.fn('BrowserHandlers.sourceSites')(function* ({ params }) {
          const browser = yield* findBrowser;
          const source = yield* readOrFail(decodeSource(params.sourceId), SOURCE_INVALID);
          return { sites: yield* failBrowser(browser.cookies.listSourceSites(source)) };
        })
      )
      .handle(
        'copy',
        Effect.fn('BrowserHandlers.copy')(function* ({ params, payload }) {
          const browser = yield* findBrowser;
          const profile = yield* findProfile(params.projectId);
          const source = yield* readOrFail(decodeSource(payload.source), SOURCE_INVALID);
          const sites = yield* readOrFail(decodeSites(payload.sites), SITES_INVALID);
          return yield* failBrowser(browser.cookies.copy(profile, source, sites));
        })
      )
      .handle(
        'openWindow',
        Effect.fn('BrowserHandlers.openWindow')(function* ({ params, payload }) {
          const browser = yield* findBrowser;
          const profile = yield* findProfile(params.projectId);
          const url =
            payload.url === undefined || payload.url === null
              ? null
              : yield* readOrFail(decodeUrl(payload.url), URL_INVALID);
          yield* failBrowser(browser.host.openWindow(profile, url));
          return yield* describeProject(profile);
        })
      )
      .handle(
        'closeWindow',
        Effect.fn('BrowserHandlers.closeWindow')(function* ({ params }) {
          const browser = yield* findBrowser;
          const profile = yield* findProfile(params.projectId);
          yield* browser.host.closeWindow(profile);
          return yield* describeProject(profile);
        })
      )
      .handle(
        'removeSite',
        Effect.fn('BrowserHandlers.removeSite')(function* ({ params, payload }) {
          const browser = yield* findBrowser;
          const profile = yield* findProfile(params.projectId);
          const site = yield* readOrFail(decodeSite(payload.site), SITE_INVALID);
          const answer: BrowserProjectAnswer = {
            mode: yield* browser.host.resolveMode(profile),
            sites: yield* failBrowser(browser.cookies.removeSite(profile, site)),
          };
          return answer;
        })
      )
      .handle(
        'signOut',
        Effect.fn('BrowserHandlers.signOut')(function* ({ params }) {
          const browser = yield* findBrowser;
          const profile = yield* findProfile(params.projectId);
          yield* browser.host.remove(profile);
          return yield* describeProject(profile);
        })
      );
  })
);
