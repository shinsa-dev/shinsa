import type { MachineCredentials, PairPollResponse, PairStartResponse } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { ControlClient } from './control.ts';

export const PAIR_POLL_MS = 2_000;

export interface PairingView {
  claimCode: string;
  url: string;
  expiresAt: number;
}

export interface PairedMachine {
  credentials: MachineCredentials;
  owner: string;
}

export type PairingEnd = { status: 'claimed'; machine: PairedMachine } | { status: 'expired' | 'cancelled' };

interface PairingOptions {
  control: ControlClient;
  start: PairStartResponse;
  pollMs: number;
  now: () => number;
}

export class Pairing {
  readonly view: PairingView;
  readonly done: Promise<PairingEnd>;
  readonly #options: PairingOptions;
  #cancelled = false;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #finish: (end: PairingEnd) => void;

  constructor(options: PairingOptions) {
    this.#options = options;
    this.view = {
      claimCode: options.start.claimCode,
      url: options.start.url,
      expiresAt: options.start.expiresAt,
    };
    const { promise, resolve } = Promise.withResolvers<PairingEnd>();
    this.done = promise;
    this.#finish = resolve;
    this.#schedule();
  }

  cancel() {
    if (this.#cancelled) return;
    this.#cancelled = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#finish({ status: 'cancelled' });
  }

  #schedule() {
    this.#timer = setTimeout(() => void this.#poll(), this.#options.pollMs);
  }

  async #poll() {
    if (this.#cancelled) return;
    if (this.#options.now() >= this.view.expiresAt) {
      this.#end({ status: 'expired' });
      return;
    }
    let answer: PairPollResponse | null = null;
    try {
      answer = await this.#options.control.requestPairPoll({
        claimCode: this.#options.start.claimCode,
        pollSecret: this.#options.start.pollSecret,
      });
    } catch (error) {
      log.warn('[Remote] Could not check on pairing; trying again', { error: describeError(error) });
    }
    if (this.#cancelled) return;
    if (answer?.status === 'claimed') {
      this.#end({ status: 'claimed', machine: { credentials: answer.credentials, owner: answer.owner } });
      return;
    }
    if (answer?.status === 'expired') {
      this.#end({ status: 'expired' });
      return;
    }
    this.#schedule();
  }

  #end(end: PairingEnd) {
    this.#cancelled = true;
    this.#finish(end);
  }
}
