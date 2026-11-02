import type { MachineCredentials } from '@shinsa/core';
import { Context, type Duration } from 'effect';

export const PairPollInterval = Context.Reference<Duration.Input>(
  'shinsa/engine/remote/pairing/PairPollInterval',
  {
    defaultValue: (): Duration.Input => '2 seconds',
  }
);

export interface PairedMachine {
  readonly credentials: MachineCredentials;
  readonly owner: string;
}

export type PairingEnd = { status: 'claimed'; machine: PairedMachine } | { status: 'expired' | 'cancelled' };
