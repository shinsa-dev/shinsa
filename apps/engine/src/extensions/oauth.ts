import { randomBytes } from 'node:crypto';
import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { SecretStore } from '../secrets/store.ts';
import type { McpOAuthHandle, McpOAuthOptions } from './oauth/schema.ts';
import { makeMcpOAuth } from './oauth/service.ts';
import { SIGN_IN_PENDING_MS } from './schema.ts';

export class McpOAuth {
  readonly #handle: McpOAuthHandle;

  constructor(store: SecretStore, options: McpOAuthOptions) {
    const now = options.now ?? Date.now;
    this.#handle = edgeRuntime.runSync(
      makeMcpOAuth({
        store,
        redirectUrl: Effect.sync(options.redirectUrl),
        now: Effect.sync(now),
        random: Effect.sync(() => randomBytes(24).toString('base64url')),
        fetch: options.fetch,
        pendingMs: options.pendingMs ?? SIGN_IN_PENDING_MS,
      })
    );
  }

  isSignedIn(serverId: string) {
    return edgeRuntime.runSync(this.#handle.isSignedIn(serverId));
  }

  start(serverId: string, url: string) {
    return edgeRuntime.runPromise(this.#handle.start(serverId, url));
  }

  finish(state: string, code: string) {
    return edgeRuntime.runPromise(this.#handle.finish(state, code));
  }

  resolveAccessToken(serverId: string, url: string) {
    return edgeRuntime.runPromise(this.#handle.resolveAccessToken(serverId, url));
  }

  signOut(serverId: string) {
    edgeRuntime.runSync(this.#handle.signOut(serverId));
  }
}
