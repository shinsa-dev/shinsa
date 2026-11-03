import { Schema } from 'effect';
import type { SecretStore } from '../secrets/store.ts';
import { StoredCredentials } from './schema.ts';

const decodeCredentials = Schema.decodeUnknownSync(StoredCredentials);

export function readCredentials(store: SecretStore, serverId: string): StoredCredentials {
  return decodeCredentials(store.selectMcpCredentials(serverId));
}
