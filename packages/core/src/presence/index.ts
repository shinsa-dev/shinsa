export {
  type ActiveHoursState,
  isActiveAt,
  resolveActiveHours,
  resolveLearnedHours,
  resolveLocalSlot,
  resolveNextActiveChange,
  resolveOverrideWeek,
} from './hours.ts';
export { applyPowerEvent, observeInput } from './idle.ts';
export {
  ACTIVE_HOURS_LIMITS,
  ACTIVE_HOURS_STEP_MINUTES,
  type ActiveHours,
  type ActiveHoursSource,
  DAY_HOURS,
  type AwaySpan,
  type AwayState,
  type AwayStep,
  type LocalSlot,
  MAC_AWAY_AFTER_MINUTES,
  NO_INPUT_YET,
  type PowerEvent,
  WEEK_DAYS,
  WEEK_SLOTS,
} from './schema.ts';
