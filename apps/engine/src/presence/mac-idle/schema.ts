import { Duration } from 'effect';

export const IDLE_COMMAND = ['ioreg', '-c', 'IOHIDSystem', '-d', '4'] as const;

export const IDLE_COMMAND_TIMEOUT = Duration.seconds(5);

export const HID_IDLE_TIME = /"HIDIdleTime"\s*=\s*(\d+)/;

export const NANOSECONDS_PER_MS = 1_000_000;
