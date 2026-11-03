import type { OAuthClientProvider, OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { SecretStore } from '../../secrets/store.ts';
import { readCredentials } from '../credentials.ts';
import type { ProviderGrant } from './schema.ts';

export class StoredProvider implements OAuthClientProvider {
  readonly #store: SecretStore;
  readonly #grant: ProviderGrant;
  authorizationUrl: URL | null = null;

  constructor(store: SecretStore, grant: ProviderGrant) {
    this.#store = store;
    this.#grant = grant;
  }

  #read() {
    return readCredentials(this.#store, this.#grant.serverId);
  }

  #update(patch: Record<string, unknown>) {
    this.#store.updateMcpCredentials(this.#grant.serverId, patch);
  }

  get redirectUrl() {
    return this.#grant.redirect;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Shinsa',
      redirect_uris: [this.#grant.redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  state() {
    return this.#grant.state;
  }

  clientInformation() {
    const stored = this.#read();
    return stored.clientRedirect === this.#grant.redirect ? stored.client : undefined;
  }

  saveClientInformation(client: OAuthClientInformationMixed) {
    this.#update({ client, clientRedirect: this.#grant.redirect });
  }

  tokens() {
    return this.#read().tokens;
  }

  saveTokens(tokens: OAuthTokens) {
    this.#update({ tokens, savedAt: this.#grant.savedAt });
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
      this.#store.removeMcpCredentials(this.#grant.serverId);
      return;
    }
    const field = { client: 'client', tokens: 'tokens', verifier: 'verifier', discovery: 'discovery' }[scope];
    this.#update({ [field]: undefined });
  }
}
