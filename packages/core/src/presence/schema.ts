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
