import { Duration, Schedule } from 'effect';

export const AWAY_AFTER = Duration.minutes(10);

export const AWAY_POLL_SCHEDULE = Schedule.spaced(Duration.seconds(30));

export type PowerEvent = 'lock' | 'unlock' | 'suspend' | 'resume';

export interface AwaySpan {
  from: number;
  to: number;
}

export interface AwayState {
  lastInput: number | null;
  frozen: boolean;
}

export interface AwayStep {
  state: AwayState;
  span: AwaySpan | null;
}

export const NO_INPUT_YET: AwayState = { lastInput: null, frozen: false };
