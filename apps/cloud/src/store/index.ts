import { Layer } from 'effect';
import { MachineAccess } from './access.ts';
import { Accounts } from './accounts.ts';
import { Machines } from './machines.ts';
import { Pairings } from './pairings.ts';
import { SlackStore } from './slack.ts';
import { Teams } from './teams.ts';

export const StoreLayer = Layer.mergeAll(
  Accounts.layer,
  Pairings.layer,
  Machines.layer,
  MachineAccess.layer,
  Teams.layer,
  SlackStore.layer
);
