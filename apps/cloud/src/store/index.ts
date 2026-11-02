import { Layer } from 'effect';
import { MachineAccess } from './access/service.ts';
import { Accounts } from './accounts/service.ts';
import { Machines } from './machines/service.ts';
import { Pairings } from './pairings/service.ts';
import { SlackStore } from './slack/service.ts';
import { Teams } from './teams/service.ts';

export const StoreLayer = Layer.mergeAll(
  Accounts.layer,
  Pairings.layer,
  Machines.layer,
  MachineAccess.layer,
  Teams.layer,
  SlackStore.layer
);
