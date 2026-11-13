import { Duration, Schedule } from 'effect';

export const AWAY_POLL_SCHEDULE = Schedule.spaced(Duration.seconds(30));
