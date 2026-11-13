export const DAY_HOURS = 24;

export const WEEK_DAYS = 7;

export const WEEK_SLOTS = WEEK_DAYS * DAY_HOURS;

export const ACTIVE_HOURS_LIMITS = {
  windowDays: 28,
  minDays: 3,
  halfLifeDays: 14,
  minWeekdayDays: 2,
  coveredShare: 0.5,
  awayShare: 0.5,
  activeShare: 0.15,
} as const;

export const ACTIVE_HOURS_STEP_MINUTES = 15;

export type ActiveHoursSource = 'override' | 'away' | 'activity';

export interface ActiveHours {
  source: ActiveHoursSource;
  timeZone: string;
  week: readonly boolean[];
  observedDays: number;
}

export interface LocalSlot {
  day: number;
  weekday: number;
  hour: number;
  slot: number;
}

export const MAC_AWAY_AFTER_MINUTES = 10;

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
