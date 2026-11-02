import { Duration } from 'effect';

export const SLACK_EVENT_BODY_LIMIT_BYTES = 1024 * 1024;

export const SIGNATURE_WINDOW = Duration.minutes(5);

export const TIMESTAMP_PATTERN = /^\d{1,12}$/;
