import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { DomainError } from '@shinsa/core';
import { Effect, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import { readCredentials } from '../credentials.ts';
import { TOKEN_REFRESH_MARGIN_MS } from '../schema.ts';
import { StoredProvider } from './provider.ts';
import {
  McpSignInFailed,
  type McpOAuthDefinition,
  type McpOAuthHandle,
  type PendingSignIns,
} from './schema.ts';

export const makeMcpOAuth = Effect.fn('McpOAuth.make')(function* (definition: McpOAuthDefinition) {
  const { store } = definition;
  const pending = yield* Ref.make<PendingSignIns>(new Map());

  const createProvider = Effect.fn('McpOAuth.createProvider')(function* (serverId: string, state?: string) {
    return new StoredProvider(store, {
      serverId,
      redirect: yield* definition.redirectUrl,
      state: state ?? (yield* definition.random),
      savedAt: yield* definition.now,
    });
  });

  const authorize = (provider: StoredProvider, serverUrl: string, authorizationCode?: string) =>
    Effect.tryPromise({
      try: () =>
        auth(provider, {
          serverUrl,
          ...(authorizationCode ? { authorizationCode } : {}),
          ...(definition.fetch ? { fetchFn: definition.fetch } : {}),
        }),
      catch: (error) => new McpSignInFailed({ message: describeError(error) }),
    });

  const isSignedIn = (serverId: string) =>
    Effect.sync(() => readCredentials(store, serverId).tokens !== undefined);

  const start = Effect.fn('McpOAuth.start')(function* (serverId: string, url: string) {
    const state = yield* definition.random;
    const provider = yield* createProvider(serverId, state);
    const result = yield* authorize(provider, url);
    if (result === 'AUTHORIZED' || !provider.authorizationUrl) return null;
    const expiresAt = (yield* definition.now) + definition.pendingMs;
    yield* Ref.update(pending, (signIns) => new Map(signIns).set(state, { serverId, url, expiresAt }));
    return provider.authorizationUrl.toString();
  });

  const finish = Effect.fn('McpOAuth.finish')(function* (state: string, code: string) {
    const signIn = (yield* Ref.get(pending)).get(state);
    yield* Ref.update(pending, (signIns) => {
      const next = new Map(signIns);
      next.delete(state);
      return next;
    });
    if (!signIn || signIn.expiresAt < (yield* definition.now)) {
      return yield* new DomainError({
        code: 'sign_in_expired',
        message: 'This sign-in expired. Connect again.',
      });
    }
    yield* authorize(yield* createProvider(signIn.serverId), signIn.url, code);
    return signIn.serverId;
  });

  const resolveAccessToken = Effect.fn('McpOAuth.resolveAccessToken')(function* (
    serverId: string,
    url: string
  ) {
    const stored = readCredentials(store, serverId);
    const tokens = stored.tokens;
    if (!tokens) return null;
    const expiresAt = tokens.expires_in && stored.savedAt ? stored.savedAt + tokens.expires_in * 1000 : null;
    const now = yield* definition.now;
    if (expiresAt !== null && expiresAt - TOKEN_REFRESH_MARGIN_MS < now && tokens.refresh_token) {
      yield* authorize(yield* createProvider(serverId), url).pipe(
        Effect.catch((failure) =>
          Effect.logWarning('[Extensions] Could not refresh an MCP sign-in').pipe(
            Effect.annotateLogs({ serverId, error: failure.message })
          )
        )
      );
    }
    return readCredentials(store, serverId).tokens?.access_token ?? null;
  });

  const handle: McpOAuthHandle = {
    isSignedIn,
    start,
    finish,
    resolveAccessToken,
    signOut: (serverId) => Effect.sync(() => store.removeMcpCredentials(serverId)),
  };
  return handle;
});
