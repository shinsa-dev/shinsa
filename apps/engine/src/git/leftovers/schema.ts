import { Duration, Schedule } from 'effect';

export interface StopOptions {
  spare?: number[];
  graceMs?: number;
  owner?: number;
}

export const STOP_GRACE = Duration.seconds(3);

const STOP_POLL = Duration.millis(50);

export const STOP_POLL_SCHEDULE = Schedule.spaced(STOP_POLL);

export const LIST_TIMEOUT = Duration.seconds(10);

export const ORPHAN_PARENT = 1;

export const LSOF_COMMAND = ['lsof', '-w', '-d', 'cwd', '-Fpn'] as const;

export const PS_COMMAND = ['ps', '-A', '-o', 'pid=,ppid='] as const;
