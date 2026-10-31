import { randomBytes } from 'node:crypto';
import {
  auth,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { DomainError } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { SecretStore } from '../secrets/store.ts';

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

interface McpOAuthOptions {
  redirectUrl: () => string;
  now?: () => number;
  fetch?: FetchLike;
  pendingMs?: number;
}

interface PendingSignIn {
  serverId: string;
  url: string;
  expiresAt: number;
}

interface StoredCredentials {
  client?: OAuthClientInformationMixed;
  clientRedirect?: string;
  tokens?: OAuthTokens;
  savedAt?: number;
  verifier?: string;
  discovery?: OAuthDiscoveryState;
}

const PENDING_MS = 10 * 60 * 1000;

const REFRESH_MARGIN_MS = 60_000;

class StoredProvider implements OAuthClientProvider {
  readonly #store: SecretStore;
  readonly #serverId: string;
  readonly #redirect: string;
  readonly #state: string | null;
  readonly #now: () => number;
  authorizationUrl: URL | null = null;

  constructor(
    store: SecretStore,
    serverId: string,
    redirect: string,
    state: string | null,
    now: () => number
  ) {
    this.#store = store;
    this.#serverId = serverId;
    this.#redirect = redirect;
    this.#state = state;
    this.#now = now;
  }

  #read(): StoredCredentials {
    return this.#store.selectMcpCredentials(this.#serverId) as StoredCredentials;
  }

  #update(patch: StoredCredentials) {
    this.#store.updateMcpCredentials(this.#serverId, patch as Record<string, unknown>);
  }

  get redirectUrl() {
    return this.#redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Shinsa',
      redirect_uris: [this.#redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state() {
    return this.#state ?? randomBytes(24).toString('base64url');
  }

  clientInformation() {
    const stored = this.#read();
    return stored.clientRedirect === this.#redirect ? stored.client : undefined;
  }

  saveClientInformation(client: OAuthClientInformationMixed) {
    this.#update({ client, clientRedirect: this.#redirect });
  }

  tokens() {
    return this.#read().tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.#update({ tokens, savedAt: this.#now() });
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  saveCodeVerifier(verifier: string) {
    this.#update({ verifier });
  }

  codeVerifier() {
    const verifier = this.#read().verifier;
    if (!verifier) throw new Error('The sign-in was not started from this Shinsa.');
    return verifier;
  }

  saveDiscoveryState(discovery: OAuthDiscoveryState) {
    this.#update({ discovery });
  }

  discoveryState() {
    return this.#read().discovery;
  }

  invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery') {
    if (scope === 'all') {
      this.#store.removeMcpCredentials(this.#serverId);
      return;
    }
    const field = { client: 'client', tokens: 'tokens', verifier: 'verifier', discovery: 'discovery' }[scope];
    this.#update({ [field]: undefined });
  }
}

export class McpOAuth {
  readonly #store: SecretStore;
  readonly #redirectUrl: () => string;
  readonly #now: () => number;
  readonly #fetch: FetchLike | undefined;
  readonly #pendingMs: number;
  readonly #pending = new Map<string, PendingSignIn>();

  constructor(store: SecretStore, options: McpOAuthOptions) {
    this.#store = store;
    this.#redirectUrl = options.redirectUrl;
    this.#now = options.now ?? Date.now;
    this.#fetch = options.fetch;
    this.#pendingMs = options.pendingMs ?? PENDING_MS;
  }

  #provider(serverId: string, state: string | null = null) {
    return new StoredProvider(this.#store, serverId, this.#redirectUrl(), state, this.#now);
  }

  #options(url: string, authorizationCode?: string) {
    return {
      serverUrl: url,
      ...(authorizationCode ? { authorizationCode } : {}),
      ...(this.#fetch ? { fetchFn: this.#fetch } : {}),
    };
  }

  isSignedIn(serverId: string) {
    return (this.#store.selectMcpCredentials(serverId) as StoredCredentials).tokens !== undefined;
  }

  async start(serverId: string, url: string) {
    const state = randomBytes(24).toString('base64url');
    const provider = this.#provider(serverId, state);
    const result = await auth(provider, this.#options(url));
    if (result === 'AUTHORIZED' || !provider.authorizationUrl) return null;
    this.#pending.set(state, { serverId, url, expiresAt: this.#now() + this.#pendingMs });
    return provider.authorizationUrl.toString();
  }

  async finish(state: string, code: string) {
    const pending = this.#pending.get(state);
    this.#pending.delete(state);
    if (!pending || pending.expiresAt < this.#now()) {
      throw new DomainError('sign_in_expired', 'This sign-in expired. Connect again.');
    }
    await auth(this.#provider(pending.serverId), this.#options(pending.url, code));
    return pending.serverId;
  }

  async resolveAccessToken(serverId: string, url: string) {
    const stored = this.#store.selectMcpCredentials(serverId) as StoredCredentials;
    const tokens = stored.tokens;
    if (!tokens) return null;
    const expiresAt = tokens.expires_in && stored.savedAt ? stored.savedAt + tokens.expires_in * 1000 : null;
    if (expiresAt !== null && expiresAt - REFRESH_MARGIN_MS < this.#now() && tokens.refresh_token) {
      try {
        await auth(this.#provider(serverId), this.#options(url));
      } catch (error) {
        log.warn('[Extensions] Could not refresh an MCP sign-in', { serverId, error: describeError(error) });
      }
    }
    return (this.#store.selectMcpCredentials(serverId) as StoredCredentials).tokens?.access_token ?? null;
  }

  signOut(serverId: string) {
    this.#store.removeMcpCredentials(serverId);
  }
}
