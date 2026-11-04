import type { StoredAccount } from '../schema.ts';

export type AccountChange = Partial<Omit<StoredAccount, 'id' | 'configDir' | 'addedAt'>>;
