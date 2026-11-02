import type { PairPollResponse } from '@shinsa/core';
import { Duration } from 'effect';

export const PAIR_TTL = Duration.minutes(10);

export const MAX_PENDING_PAIRS_PER_ADDRESS = 10;

export const EXPIRED: PairPollResponse = { status: 'expired' };
