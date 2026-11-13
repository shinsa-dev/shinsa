import type { AwayState } from '@shinsa/core';
import { Duration } from 'effect';

export const IDLE_POLL_INTERVAL = Duration.seconds(30);

export interface IdleWatchState {
  away: AwayState;
  sentHour: number | null;
}
