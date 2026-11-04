import { Layer } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { AccountChanges } from './changes/service.ts';
import { AccountCommands } from './command/service.ts';
import { StoredLogins } from './credentials/service.ts';
import { Cswap } from './cswap/service.ts';
import { AccountFolders } from './folders/service.ts';
import { AccountImports } from './imports/service.ts';
import { Keychain } from './keychain/service.ts';
import { UsageLimits } from './limits/service.ts';
import { AccountLogins } from './login/service.ts';
import { UsageReadings } from './readings/service.ts';
import { AccountRegistry } from './registry/service.ts';
import { LoginRenewal } from './renewal/service.ts';
import { UsageResume } from './resume/service.ts';
import { Accounts } from './roster/service.ts';
import { AccountRotation } from './rotation/service.ts';
import { AccountSignIns } from './sign-ins/service.ts';
import { AuthStatusReader } from './status/service.ts';
import { AccountStore } from './store/service.ts';
import { UsageApi } from './usage/service.ts';

const UsageApiLayer = UsageApi.layer.pipe(
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(Layer.succeed(HttpClient.TracerPropagationEnabled, false))
);

export const AccountsLayer = Layer.mergeAll(Accounts.layer, UsageResume.layer).pipe(
  Layer.provideMerge(AccountRotation.layer),
  Layer.provideMerge(Layer.mergeAll(UsageLimits.layer, AccountImports.layer)),
  Layer.provideMerge(
    Layer.mergeAll(Cswap.layer, UsageReadings.layer, LoginRenewal.layer, AccountLogins.layer)
  ),
  Layer.provideMerge(AccountStore.layer),
  Layer.provideMerge(StoredLogins.layer),
  Layer.provideMerge(Layer.mergeAll(Keychain.layer, AuthStatusReader.layer)),
  Layer.provideMerge(
    Layer.mergeAll(
      AccountRegistry.layer,
      AccountFolders.layer,
      AccountChanges.layer,
      AccountSignIns.layer,
      AccountCommands.layer,
      UsageApiLayer
    )
  )
);
