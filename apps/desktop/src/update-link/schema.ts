import { Duration, Schedule } from 'effect';

export const UPDATE_REPORT_SCHEDULE = Schedule.spaced(Duration.seconds(5));
