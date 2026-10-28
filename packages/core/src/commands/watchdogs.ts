import type { WatchIssue } from '../report/types.ts';

export type WatchdogUserCommand =
  | { type: 'watchdog.stop'; taskId: string; watchdogId: string }
  | { type: 'watchdog.connect'; taskId: string; watchdogId: string; server: string; data: string }
  | { type: 'watch_source.write'; projectId: string; server: string; data: string; repoIds: string[] }
  | { type: 'watch_source.remove'; projectId: string; server: string };

export type WatchdogAgentCommand = {
  type: 'agent.report_watch';
  runId: string;
  healthy: boolean;
  summary: string;
  issue: WatchIssue | null;
};

export type WatchdogSystemCommand = {
  type: 'watchdog.fire';
  taskId: string;
  watchdogId: string;
  dueAt: number;
};
