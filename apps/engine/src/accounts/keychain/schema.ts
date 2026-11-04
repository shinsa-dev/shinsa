import { Context } from 'effect';

export const KeychainPlatform = Context.Reference<string>(
  'shinsa/engine/accounts/keychain/KeychainPlatform',
  {
    defaultValue: () => process.platform,
  }
);
