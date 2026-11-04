import { randomBytes } from 'node:crypto';
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { DomainError } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Ref, Schema } from 'effect';
import { describeError } from '../../log/redact.ts';
import { SecretStore } from '../../secrets/store/service.ts';
import { SIGN_IN_PENDING_MS, StoredCredentials, TOKEN_REFRESH_MARGIN_MS } from '../schema.ts';
import {
  type McpOAuthInput,
  McpSignInFailed,
  type PendingSignIns,
  type ProviderGrant,
  SIGN_IN_NOT_STARTED,
} from './schema.ts';

export class McpOAuth extends Context.Service<
  McpOAuth,
  {
    readonly isSignedIn: (serverId: string) => Effect.Effect<boolean>;
    readonly start: (serverId: string, url: string) => Effect.Effect<string | null, McpSignInFailed>;
    readonly finish: (state: string, code: string) => Effect.Effect<string, McpSignInFailed | DomainError>;
    readonly resolveAccessToken: (serverId: string, url: string) => Effect.Effect<string | null>;
    readonly signOut: (serverId: string) => Effect.Effect<void>;
  }
>()('shinsa/engine/extensions/oauth/McpOAuth') {
  static readonly layer = (input: McpOAuthInput) =>
    Layer.effect(
      McpOAuth,
      Effect.gen(function* () {
        const secrets = yield* SecretStore;
        const run = Effect.runPromiseWith(yield* Effect.context<never>());
        const decodeCredentials = Schema.decodeUnknownEffect(StoredCredentials);
        const pending = yield* Ref.make<PendingSignIns>(new Map());
        const random = Effect.sync(() => randomBytes(24).toString('base64url'));

        const readStored = (serverId: string) =>
          Effect.flatMap(secrets.selectMcpCredentials(serverId), (stored) =>
            Effect.orDie(decodeCredentials(stored))
          );

        const createProvider = (grant: ProviderGrant) => {
          const update = (patch: Record<string, unknown>) =>
            run(secrets.updateMcpCredentials(grant.serverId, patch));
          const fields = { client: 'client', tokens: 'tokens', verifier: 'verifier', discovery: 'discovery' };
          const opened: { provider: OAuthClientProvider; authorizationUrl: URL | null } = {
            authorizationUrl: null,
            provider: {
              redirectUrl: grant.redirect,
              clientMetadata: {
                client_name: 'Shinsa',
                redirect_uris: [grant.redirect],
                grant_types: ['authorization_code', 'refresh_token'],
                response_types: ['code'],
                token_endpoint_auth_method: 'none',
              },
              state: () => Promise.resolve(grant.state),
              clientInformation: () =>
                run(
                  Effect.map(readStored(grant.serverId), (stored) =>
                    stored.clientRedirect === grant.redirect ? stored.client : undefined
                  )
                ),
              saveClientInformation: (client) => update({ client, clientRedirect: grant.redirect }),
              tokens: () => run(Effect.map(readStored(grant.serverId), (stored) => stored.tokens)),
              saveTokens: (tokens) => update({ tokens, savedAt: grant.savedAt }),
              redirectToAuthorization: (url) => {
                opened.authorizationUrl = url;
              },
              saveCodeVerifier: (verifier) => update({ verifier }),
              codeVerifier: () =>
                run(
                  Effect.flatMap(readStored(grant.serverId), (stored) =>
                    stored.verifier
                      ? Effect.succeed(stored.verifier)
                      : Effect.fail(new McpSignInFailed({ message: SIGN_IN_NOT_STARTED }))
                  )
                ),
              saveDiscoveryState: (discovery) => update({ discovery }),
              discoveryState: () => run(Effect.map(readStored(grant.serverId), (stored) => stored.discovery)),
              invalidateCredentials: (scope) =>
                run(
                  scope === 'all'
                    ? secrets.removeMcpCredentials(grant.serverId)
                    : secrets.updateMcpCredentials(grant.serverId, { [fields[scope]]: undefined })
                ),
            },
          };
          return opened;
        };

        const openProvider = Effect.fn('McpOAuth.openProvider')(function* (serverId: string, state?: string) {
          return createProvider({
            serverId,
            redirect: yield* input.redirectUrl,
            state: state ?? (yield* random),
            savedAt: yield* Clock.currentTimeMillis,
          });
        });

        const authorize = (provider: OAuthClientProvider, serverUrl: string, authorizationCode?: string) =>
          Effect.tryPromise({
            try: () =>
              auth(provider, {
                serverUrl,
                ...(authorizationCode ? { authorizationCode } : {}),
                ...(input.fetch ? { fetchFn: input.fetch } : {}),
              }),
            catch: (error) => new McpSignInFailed({ message: describeError(error) }),
          });

        const isSignedIn = (serverId: string) =>
          Effect.map(readStored(serverId), (stored) => stored.tokens !== undefined);

        const start = Effect.fn('McpOAuth.start')(function* (serverId: string, url: string) {
          const state = yield* random;
          const opened = yield* openProvider(serverId, state);
          const result = yield* authorize(opened.provider, url);
          if (result === 'AUTHORIZED' || !opened.authorizationUrl) return null;
          const expiresAt = (yield* Clock.currentTimeMillis) + SIGN_IN_PENDING_MS;
          yield* Ref.update(pending, (signIns) => new Map(signIns).set(state, { serverId, url, expiresAt }));
          return opened.authorizationUrl.toString();
        });

        const finish = Effect.fn('McpOAuth.finish')(function* (state: string, code: string) {
          const signIn = (yield* Ref.get(pending)).get(state);
          yield* Ref.update(pending, (signIns) => {
            const next = new Map(signIns);
            next.delete(state);
            return next;
          });
          if (!signIn || signIn.expiresAt < (yield* Clock.currentTimeMillis)) {
            return yield* new DomainError({
              code: 'sign_in_expired',
              message: 'This sign-in expired. Connect again.',
            });
          }
          yield* authorize((yield* openProvider(signIn.serverId)).provider, signIn.url, code);
          return signIn.serverId;
        });

        const resolveAccessToken = Effect.fn('McpOAuth.resolveAccessToken')(function* (
          serverId: string,
          url: string
        ) {
          const stored = yield* readStored(serverId);
          const tokens = stored.tokens;
          if (!tokens) return null;
          const expiresAt =
            tokens.expires_in && stored.savedAt ? stored.savedAt + tokens.expires_in * 1000 : null;
          const now = yield* Clock.currentTimeMillis;
          if (expiresAt !== null && expiresAt - TOKEN_REFRESH_MARGIN_MS < now && tokens.refresh_token) {
            yield* authorize((yield* openProvider(serverId)).provider, url).pipe(
              Effect.catch((failure) =>
                Effect.logWarning('[Extensions] Could not refresh an MCP sign-in').pipe(
                  Effect.annotateLogs({ serverId, error: failure.message })
                )
              )
            );
          }
          return (yield* readStored(serverId)).tokens?.access_token ?? null;
        });

        return McpOAuth.of({
          isSignedIn,
          start,
          finish,
          resolveAccessToken,
          signOut: secrets.removeMcpCredentials,
        });
      })
    );
}
