import type { SignInCheck } from '@shinsa/core';
import { Clock, Context, Duration, Effect, Layer, Option, Schema } from 'effect';
import { sendCdpCommand } from '../cdp/command.ts';
import type { BrowserProfile } from '../host/schema.ts';
import { BrowserHost } from '../host/service.ts';
import {
  BrowserSignInCheckSettings,
  CreatedTarget,
  PAGE_LOADED,
  PageReading,
  READ_PAGE_EXPRESSION,
  type StableUrl,
} from './schema.ts';

export class BrowserSignInCheck extends Context.Service<
  BrowserSignInCheck,
  { check(profile: BrowserProfile, url: string): Effect.Effect<SignInCheck> }
>()('shinsa/engine/browser/check/BrowserSignInCheck') {
  static readonly layer = Layer.effect(
    BrowserSignInCheck,
    Effect.gen(function* () {
      const host = yield* BrowserHost;
      const settings = yield* BrowserSignInCheckSettings;
      const settleMs = Duration.toMillis(settings.settle);
      const decodeTarget = Schema.decodeUnknownEffect(CreatedTarget);
      const decodeReading = Schema.decodeUnknownEffect(PageReading);

      const resolvePageSocket = (browserSocket: string, targetId: string) => {
        const page = new URL(browserSocket);
        page.pathname = `/devtools/page/${targetId}`;
        return page.toString();
      };

      const readPage = (pageSocket: string) =>
        sendCdpCommand(pageSocket, 'Runtime.evaluate', {
          expression: READ_PAGE_EXPRESSION,
          returnByValue: true,
        }).pipe(
          Effect.flatMap(decodeReading),
          Effect.map((reading) => Option.some(reading.result.value)),
          Effect.orElseSucceed(Option.none)
        );

      const awaitSettledUrl: (
        pageSocket: string,
        stable?: Option.Option<StableUrl>
      ) => Effect.Effect<string> = Effect.fn('BrowserSignInCheck.awaitSettledUrl')(function* (
        pageSocket: string,
        stable: Option.Option<StableUrl> = Option.none()
      ) {
        const reading = yield* readPage(pageSocket);
        const now = yield* Clock.currentTimeMillis;
        const loaded = Option.filter(reading, (page) => page.ready === PAGE_LOADED);
        if (Option.isNone(loaded)) {
          yield* Effect.sleep(settings.poll);
          return yield* awaitSettledUrl(pageSocket);
        }
        const same = Option.filter(stable, (seen) => seen.url === loaded.value.url);
        if (Option.isSome(same) && now - same.value.since >= settleMs) return same.value.url;
        yield* Effect.sleep(settings.poll);
        return yield* awaitSettledUrl(
          pageSocket,
          Option.orElse(same, () => Option.some({ url: loaded.value.url, since: now }))
        );
      });

      const openAndRead = Effect.fn('BrowserSignInCheck.openAndRead')(function* (
        browserSocket: string,
        url: string
      ) {
        const { targetId } = yield* sendCdpCommand(browserSocket, 'Target.createTarget', { url }).pipe(
          Effect.flatMap(decodeTarget)
        );
        const closeTarget = Effect.ignore(sendCdpCommand(browserSocket, 'Target.closeTarget', { targetId }));
        return yield* awaitSettledUrl(resolvePageSocket(browserSocket, targetId)).pipe(
          Effect.timeoutOption(settings.cap),
          Effect.map(
            Option.match({
              onNone: (): SignInCheck => ({ kind: 'unchecked', reason: 'timeout' }),
              onSome: (landed): SignInCheck => ({ kind: 'landed', url: landed }),
            })
          ),
          Effect.ensuring(closeTarget)
        );
      });

      const check = Effect.fn('BrowserSignInCheck.check')(function* (profile: BrowserProfile, url: string) {
        const result = yield* host.acquire(profile).pipe(
          Effect.flatMap((endpoint) => openAndRead(endpoint.webSocketUrl, url)),
          Effect.catchTag('BrowserUnavailable', (unavailable) =>
            Effect.succeed<SignInCheck>({ kind: 'unchecked', reason: unavailable.reason })
          ),
          Effect.orElseSucceed((): SignInCheck => ({ kind: 'unchecked', reason: 'failed' })),
          Effect.scoped
        );
        yield* Effect.logInfo('[Browser] Checked a sign-in').pipe(
          Effect.annotateLogs({
            profile,
            url,
            outcome: result.kind === 'landed' ? result.url : result.reason,
          })
        );
        return result;
      });

      return BrowserSignInCheck.of({ check });
    })
  );
}
