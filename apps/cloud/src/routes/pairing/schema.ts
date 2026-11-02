import { ClaimCode, type PairPollResponse } from '@shinsa/core';
import { Duration, Schema } from 'effect';

export const PAIR_TTL = Duration.minutes(10);

export const MAX_PENDING_PAIRS_PER_ADDRESS = 10;

export const decodeClaimCode = Schema.decodeUnknownOption(ClaimCode);

export const EXPIRED: PairPollResponse = { status: 'expired' };
