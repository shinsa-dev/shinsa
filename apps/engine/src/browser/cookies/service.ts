import { join } from 'node:path';
import { SqliteClient } from '@effect/sql-sqlite-bun';
import type {
  BrowserCopyAnswer,
  BrowserSite,
  SourceBrowserAnswer,
  SourceBrowserId,
} from '@shinsa/core/engine-api/schema';
import { Clock, Context, Duration, Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { EngineConfig } from '../../config/service.ts';
import { Shell } from '../../shell/service.ts';
import { SQL_NAMES } from '../../store/shared/schema.ts';
import { sendCdpCommand } from '../cdp/command.ts';
import type { CdpFailed } from '../cdp/schema.ts';
import type { BrowserProfile, BrowserUnavailable } from '../host/schema.ts';
import { BrowserHost } from '../host/service.ts';
import { createCookieKey, decryptCookieValue } from './decrypt.ts';
import { resolveCookieParam } from './params.ts';
import {
  CDP_SAME_SITE_NONE,
  CdpCookies,
  COOKIE_FILE_COMPANIONS,
  COOKIE_FILES,
  type CookieParam,
  CookieSourceUnavailable,
  COPY_BATCH,
  KEYCHAIN_REFUSED_MESSAGE,
  KEYCHAIN_TIMEOUT,
  KeychainRefused,
  LAUNCH_SERVICES_PLIST,
  LaunchServicesHandlers,
  SiteCookieRow,
  STORED_SAME_SITE_NONE,
  SOURCE_BROWSERS,
  SOURCE_NOT_INSTALLED_MESSAGE,
  SOURCE_UNREADABLE_MESSAGE,
  type SourceBrowser,
  StoredCookieRow,
} from './schema.ts';
import { isOnSites, listBrowserSites } from './sites.ts';

export class BrowserCookies extends Context.Service<
  BrowserCookies,
  {
    readonly listSources: Effect.Effect<ReadonlyArray<SourceBrowserAnswer>>;
    listSourceSites(
      source: SourceBrowserId
    ): Effect.Effect<ReadonlyArray<BrowserSite>, CookieSourceUnavailable>;
    copy(
      profile: BrowserProfile,
      source: SourceBrowserId,
      sites: ReadonlyArray<string>
    ): Effect.Effect<
      BrowserCopyAnswer,
      CookieSourceUnavailable | KeychainRefused | BrowserUnavailable | CdpFailed
    >;
    listSites(profile: BrowserProfile): Effect.Effect<ReadonlyArray<BrowserSite>>;
  }
>()('shinsa/engine/browser/cookies/BrowserCookies') {
  static readonly layer = Layer.effect(
    BrowserCookies,
    Effect.gen(function* () {
      const config = yield* EngineConfig;
      const fs = yield* FileSystem.FileSystem;
      const shell = yield* Shell;
      const host = yield* BrowserHost;
      const decodeHandlers = Schema.decodeUnknownOption(LaunchServicesHandlers);
      const decodeCdpCookies = Schema.decodeUnknownOption(CdpCookies);
      const unreadable = new CookieSourceUnavailable({
        reason: 'unreadable',
        message: SOURCE_UNREADABLE_MESSAGE,
      });
      const notInstalled = new CookieSourceUnavailable({
        reason: 'not_installed',
        message: SOURCE_NOT_INSTALLED_MESSAGE,
      });

      const exists = (path: string) => fs.exists(path).pipe(Effect.orElseSucceed(() => false));

      const selectCookieFile = Effect.fn('BrowserCookies.selectCookieFile')(function* (dataDir: string) {
        for (const file of COOKIE_FILES) {
          const path = join(dataDir, file);
          if (yield* exists(path)) return Option.some(path);
        }
        return Option.none<string>();
      });

      const findSource = (id: SourceBrowserId) =>
        Effect.fromNullishOr(SOURCE_BROWSERS.find((source) => source.id === id)).pipe(
          Effect.mapError(() => notInstalled)
        );

      const findSourceFile = Effect.fn('BrowserCookies.findSourceFile')(function* (source: SourceBrowser) {
        const file = yield* selectCookieFile(join(config.userHome, source.dataDir));
        if (Option.isNone(file)) return yield* notInstalled;
        return file.value;
      });

      const withCookieDatabase = <A, E>(file: string, use: Effect.Effect<A, E, SqlClient.SqlClient>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const scratch = yield* fs.makeTempDirectoryScoped({ prefix: 'shinsa-cookies-' });
            const copy = join(scratch, 'Cookies');
            yield* fs.copyFile(file, copy);
            for (const suffix of COOKIE_FILE_COMPANIONS) {
              if (yield* exists(`${file}${suffix}`))
                yield* fs.copyFile(`${file}${suffix}`, `${copy}${suffix}`);
            }
            return yield* Effect.provide(
              use,
              SqliteClient.layer({ filename: copy, disableWAL: true, ...SQL_NAMES })
            );
          })
        ).pipe(Effect.mapError(() => unreadable));

      const listFileSites = (file: string) =>
        withCookieDatabase(
          file,
          Effect.flatMap(SqlClient.SqlClient, (sql) =>
            SqlSchema.findAll({
              Request: Schema.Void,
              Result: SiteCookieRow,
              execute: () => sql`SELECT host_key, name, is_httponly, samesite FROM cookies`,
            })(undefined)
          )
        ).pipe(
          Effect.map((rows) =>
            listBrowserSites(
              rows.map((row) => ({
                host: row.hostKey,
                name: row.name,
                httpOnly: row.isHttponly === 1,
                crossSite: row.samesite === STORED_SAME_SITE_NONE,
              }))
            )
          )
        );

      const resolveDefaultBundle = shell
        .run({
          argv: [
            'plutil',
            '-extract',
            'LSHandlers',
            'json',
            '-o',
            '-',
            join(config.userHome, LAUNCH_SERVICES_PLIST),
          ],
          cwd: config.userHome,
          timeout: Duration.seconds(5),
        })
        .pipe(
          Effect.map(
            (result) =>
              Option.getOrNull(decodeHandlers(result.stdout))?.find(
                (handler) => handler.LSHandlerURLScheme === 'https'
              )?.LSHandlerRoleAll ?? null
          ),
          Effect.orElseSucceed(() => null)
        );

      const listSources = Effect.gen(function* () {
        const defaultBundle = yield* resolveDefaultBundle;
        const sources: SourceBrowserAnswer[] = [];
        for (const source of SOURCE_BROWSERS) {
          const file = yield* selectCookieFile(join(config.userHome, source.dataDir));
          if (Option.isNone(file)) continue;
          sources.push({ id: source.id, name: source.name, isDefault: source.bundleId === defaultBundle });
        }
        return sources.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
      }).pipe(Effect.withSpan('BrowserCookies.listSources'));

      const listSourceSites = Effect.fn('BrowserCookies.listSourceSites')(function* (id: SourceBrowserId) {
        return yield* listFileSites(yield* findSourceFile(yield* findSource(id)));
      });

      const readKeychainPassword = Effect.fn('BrowserCookies.readKeychainPassword')(function* (
        source: SourceBrowser
      ) {
        const result = yield* shell
          .run({
            argv: ['security', 'find-generic-password', '-w', '-s', source.keychainService],
            cwd: config.userHome,
            timeout: KEYCHAIN_TIMEOUT,
          })
          .pipe(Effect.mapError(() => new KeychainRefused({ message: KEYCHAIN_REFUSED_MESSAGE })));
        const password = result.stdout.trim();
        if (!result.ok || password === '')
          return yield* new KeychainRefused({ message: KEYCHAIN_REFUSED_MESSAGE });
        return password;
      });

      const readSourceCookies = (file: string, password: string, sites: ReadonlySet<string>, now: number) =>
        withCookieDatabase(
          file,
          Effect.flatMap(SqlClient.SqlClient, (sql) =>
            SqlSchema.findAll({
              Request: Schema.Void,
              Result: StoredCookieRow,
              execute: () =>
                sql`SELECT host_key, top_frame_site_key, name, value, encrypted_value, path, expires_utc,
                           is_secure, is_httponly, is_persistent, priority, samesite
                    FROM cookies`,
            })(undefined)
          )
        ).pipe(
          Effect.map((rows) => {
            const key = createCookieKey(password);
            const params: CookieParam[] = [];
            let skipped = 0;
            for (const row of rows) {
              if (!isOnSites(row.hostKey, sites)) continue;
              const value =
                row.value === '' ? decryptCookieValue(key, row.encryptedValue, row.hostKey) : row.value;
              const param = value === null ? null : resolveCookieParam(row, value, now);
              if (param) params.push(param);
              else skipped += 1;
            }
            return { params, skipped };
          })
        );

      const listProfileSites = Effect.fn('BrowserCookies.listProfileSites')(function* (
        profile: BrowserProfile
      ) {
        const live = yield* Effect.scoped(
          Effect.flatMap(host.acquire(profile), (endpoint) =>
            sendCdpCommand(endpoint.webSocketUrl, 'Storage.getCookies')
          )
        ).pipe(Effect.option);
        const decoded = Option.flatMap(live, decodeCdpCookies);
        if (Option.isSome(decoded)) {
          return listBrowserSites(
            decoded.value.cookies.map((cookie) => ({
              host: cookie.domain,
              name: cookie.name,
              httpOnly: cookie.httpOnly,
              crossSite: cookie.sameSite === CDP_SAME_SITE_NONE,
            }))
          );
        }
        const file = yield* selectCookieFile(host.resolveProfilePath(profile));
        if (Option.isNone(file)) return [];
        return yield* listFileSites(file.value).pipe(
          Effect.orElseSucceed((): ReadonlyArray<BrowserSite> => [])
        );
      });

      const listSites = Effect.fn('BrowserCookies.listSites')(function* (profile: BrowserProfile) {
        if (!(yield* exists(host.resolveProfilePath(profile)))) return [];
        return yield* listProfileSites(profile);
      });

      const copy = Effect.fn('BrowserCookies.copy')(function* (
        profile: BrowserProfile,
        id: SourceBrowserId,
        sites: ReadonlyArray<string>
      ) {
        const source = yield* findSource(id);
        const file = yield* findSourceFile(source);
        const password = yield* readKeychainPassword(source);
        const now = Math.floor((yield* Clock.currentTimeMillis) / 1000);
        const { params, skipped } = yield* readSourceCookies(file, password, new Set(sites), now);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const endpoint = yield* host.acquire(profile);
            for (let start = 0; start < params.length; start += COPY_BATCH) {
              yield* sendCdpCommand(endpoint.webSocketUrl, 'Storage.setCookies', {
                cookies: params.slice(start, start + COPY_BATCH),
              });
            }
          })
        );
        yield* Effect.logInfo('Copied browser sign-ins').pipe(
          Effect.annotateLogs({ source: id, sites: sites.length, cookies: params.length, skipped })
        );
        const answer: BrowserCopyAnswer = {
          copied: params.length,
          skipped,
          sites: yield* listProfileSites(profile),
        };
        return answer;
      });

      return BrowserCookies.of({ listSources, listSourceSites, copy, listSites });
    })
  );
}
