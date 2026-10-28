import type { Watchdog, WatchdogCheck, WatchdogStatus, WatchSource } from '../domain/index.ts';
import type { WatchdogSource } from '../report/types.ts';

export type WatchdogEventBody =
  | { type: 'watchdog.armed'; taskId: string; watchdog: Watchdog }
  | {
      type: 'watchdog.started';
      taskId: string;
      watchdogId: string;
      source: WatchdogSource;
      endsAt: number;
      nextCheckAt: number;
    }
  | { type: 'watchdog.checking'; taskId: string; watchdogId: string; runId: string }
  | { type: 'watchdog.deferred'; taskId: string; watchdogId: string; nextCheckAt: number }
  | {
      type: 'watchdog.missed';
      taskId: string;
      watchdogId: string;
      reason: string;
      nextCheckAt: number | null;
    }
  | {
      type: 'watchdog.checked';
      taskId: string;
      watchdogId: string;
      check: WatchdogCheck;
      status: WatchdogStatus;
      nextCheckAt: number | null;
      forkTaskId: string | null;
    }
  | { type: 'watchdog.ended'; taskId: string; watchdogId: string }
  | { type: 'watch_source.written'; projectId: string; source: WatchSource }
  | { type: 'watch_source.removed'; projectId: string; server: string };
