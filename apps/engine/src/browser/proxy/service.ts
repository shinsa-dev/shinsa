import { randomBytes } from 'node:crypto';
import { Context, Effect, Exit, Layer, Ref, Schema, Scope } from 'effect';
import { ServerAddress } from '../../serve/address/service.ts';
import type { BrowserProfile, BrowserUnavailable } from '../host/schema.ts';
import { BrowserHost } from '../host/service.ts';
import { resolveBrowserEndpoint } from './endpoint.ts';
import {
  type BrowserAdmission,
  BROWSER_GONE_REASON,
  BROWSER_KEY_BYTES,
  BrowserKey,
  BrowserKeyRefused,
  type BrowserPeer,
  type BrowserRelay,
  CLOSE_GOING_AWAY,
  CLOSE_POLICY,
  type IssuedKey,
  KEY_REFUSED_MESSAGE,
  KEY_REVOKED_REASON,
  type LiveRelay,
} from './schema.ts';
import { createTargetFilter } from './targets.ts';

export class BrowserProxy extends Context.Service<
  BrowserProxy,
  {
    issue(profile: BrowserProfile): Effect.Effect<string, never, Scope.Scope>;
    admit(key: string): Effect.Effect<BrowserAdmission, BrowserKeyRefused | BrowserUnavailable>;
    open(peer: BrowserPeer, admission: BrowserAdmission): Effect.Effect<BrowserRelay>;
    dismiss(admission: BrowserAdmission): Effect.Effect<void>;
  }
>()('shinsa/engine/browser/proxy/BrowserProxy') {
  static readonly layer = Layer.effect(
    BrowserProxy,
    Effect.gen(function* () {
      const host = yield* BrowserHost;
      const address = yield* ServerAddress;
      const keys = yield* Ref.make<ReadonlyMap<BrowserKey, IssuedKey>>(new Map());
      const runSync = Effect.runSyncWith(yield* Effect.context<never>());
      const isKey = Schema.is(BrowserKey);

      const updateRelays = (key: BrowserKey, change: (relays: Set<LiveRelay>) => void) =>
        Ref.modify(keys, (all): [boolean, ReadonlyMap<BrowserKey, IssuedKey>] => {
          const issued = all.get(key);
          if (!issued) return [false, all];
          const relays = new Set(issued.relays);
          change(relays);
          return [true, new Map(all).set(key, { ...issued, relays })];
        });

      const revoke = (key: BrowserKey) =>
        Effect.flatMap(
          Ref.modify(keys, (all): [ReadonlyArray<LiveRelay>, ReadonlyMap<BrowserKey, IssuedKey>] => {
            const issued = all.get(key);
            if (!issued) return [[], all];
            const rest = new Map(all);
            rest.delete(key);
            return [[...issued.relays], rest];
          }),
          (relays) =>
            Effect.sync(() => {
              for (const relay of relays) relay.end(CLOSE_POLICY, KEY_REVOKED_REASON);
            })
        );

      const issue = Effect.fn('BrowserProxy.issue')(function* (profile: BrowserProfile) {
        const key = BrowserKey.make(
          yield* Effect.sync(() => randomBytes(BROWSER_KEY_BYTES).toString('base64url'))
        );
        yield* Effect.acquireRelease(
          Ref.update(keys, (all) => new Map(all).set(key, { profile, relays: new Set() })),
          () => revoke(key)
        );
        return resolveBrowserEndpoint(address.current(), key);
      });

      const dismiss = (admission: BrowserAdmission) => Scope.close(admission.scope, Exit.void);

      const admit = Effect.fn('BrowserProxy.admit')(function* (key: string) {
        const issued = isKey(key) ? (yield* Ref.get(keys)).get(key) : undefined;
        if (!isKey(key) || !issued) return yield* new BrowserKeyRefused({ message: KEY_REFUSED_MESSAGE });
        const scope = yield* Scope.make();
        const endpoint = yield* host.acquire(issued.profile).pipe(
          Scope.provide(scope),
          Effect.onError(() => Scope.close(scope, Exit.void))
        );
        const admission: BrowserAdmission = {
          key,
          profile: issued.profile,
          webSocketUrl: endpoint.webSocketUrl,
          scope,
        };
        return admission;
      });

      const open = Effect.fn('BrowserProxy.open')(function* (peer: BrowserPeer, admission: BrowserAdmission) {
        const ended = yield* Ref.make(false);
        const upstream = yield* Effect.sync(() => new WebSocket(admission.webSocketUrl));
        const waiting: (string | Uint8Array)[] = [];
        const targets = createTargetFilter();
        const sendUpstream = (data: string | Uint8Array) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data);
          else if (upstream.readyState === WebSocket.CONNECTING) waiting.push(data);
        };
        const finish = (live: LiveRelay) => {
          if (runSync(Ref.getAndSet(ended, true))) return false;
          runSync(
            Effect.andThen(
              updateRelays(admission.key, (relays) => relays.delete(live)),
              dismiss(admission)
            )
          );
          return true;
        };
        const live: LiveRelay = {
          end: (code, reason) => {
            if (!finish(live)) return;
            upstream.close();
            peer.close(code, reason);
          },
        };
        yield* Effect.sync(() => {
          upstream.binaryType = 'arraybuffer';
          upstream.onopen = () => {
            for (const data of waiting.splice(0)) upstream.send(data);
          };
          upstream.onmessage = (event) => {
            const { data } = event as MessageEvent<string | ArrayBuffer>;
            if (typeof data !== 'string') return peer.send(new Uint8Array(data));
            const { toAgent, toBrowser } = targets.fromBrowser(data);
            for (const message of toAgent) peer.send(message);
            for (const command of toBrowser) upstream.send(command);
          };
          upstream.onclose = () => {
            if (finish(live)) peer.close(CLOSE_GOING_AWAY, BROWSER_GONE_REASON);
          };
        });
        const registered = yield* updateRelays(admission.key, (relays) => relays.add(live));
        if (!registered) live.end(CLOSE_POLICY, KEY_REVOKED_REASON);
        const relay: BrowserRelay = {
          send: (data) => {
            if (typeof data !== 'string') return sendUpstream(data);
            const { forward, reply } = targets.fromAgent(data);
            if (reply) peer.send(reply);
            if (forward) sendUpstream(forward);
          },
          close: () => {
            if (finish(live)) upstream.close();
          },
        };
        return relay;
      });

      return BrowserProxy.of({ issue, admit, open, dismiss });
    })
  );
}
