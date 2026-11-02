import type { MachineCredentials } from '@shinsa/core';
import { Context, type Duration } from 'effect';

export const PAIR_POLL_INTERVAL: Duration.Input = '2 seconds';

export const PairPollInterval = Context.Reference<Duration.Input>(
  'shinsa/engine/remote/pairing/PairPollInterval',
  {
    defaultValue: () => PAIR_POLL_INTERVAL,
  }
);

export interface PairedMachine {
  readonly credentials: MachineCredentials;
  readonly owner: string;
}

export type PairingEnd = { status: 'claimed'; machine: PairedMachine } | { status: 'expired' | 'cancelled' };
