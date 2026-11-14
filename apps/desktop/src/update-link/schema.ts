import { Duration, Schedule } from 'effect';

export const UPDATE_REPORT_INTERVAL = Duration.seconds(5);

export const UPDATE_REPORT_SCHEDULE = Schedule.spaced(UPDATE_REPORT_INTERVAL);
