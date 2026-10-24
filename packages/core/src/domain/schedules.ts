import { DAY_MS, MINUTE_MS } from './time.ts';
import type { TaskMode, TaskPriority } from './types.ts';

export type WebhookEncoding = 'hex' | 'base64';

export interface WebhookSignature {
  header: string;
  encoding: WebhookEncoding;
  prefix: string;
}

export type ScheduleTrigger =
  | { kind: 'once'; at: number }
  | { kind: 'interval'; everyMinutes: number }
  | { kind: 'daily'; time: string; weekdays: number[] }
  | { kind: 'webhook'; signature: WebhookSignature | null; replayKey: string | null };

export type ScheduleTriggerKind = ScheduleTrigger['kind'];

export type ScheduleTarget =
  | { kind: 'new_task'; repoId: string | null; priority: TaskPriority; mode: TaskMode }
  | { kind: 'task'; taskId: string };

export type ScheduleRunOutcome = 'sent' | 'skipped' | 'failed';

export interface ScheduleRun {
  at: number;
  outcome: ScheduleRunOutcome;
  taskId: string | null;
  deliveryId: string | null;
  detail: string | null;
}

export type ScheduleCreator = { kind: 'you' } | { kind: 'agent'; taskId: string; runId: string };

export type ScheduleStop = 'finished' | 'target_gone';

export interface Schedule {
  id: string;
  name: string;
  text: string;
  trigger: ScheduleTrigger;
  target: ScheduleTarget;
  timeZone: string;
  enabled: boolean;
  nextRunAt: number | null;
  runCount: number;
  maxRuns: number | null;
  runs: ScheduleRun[];
  createdAt: number;
  updatedAt: number;
  createdBy: ScheduleCreator;
  lastTaskId: string | null;
  lastRunId: string | null;
  stopped: ScheduleStop | null;
  replayKeys: Record<string, number>;
}

export interface GateSecret {
  label: string;
}

export const SCHEDULE_LIMITS = {
  name: 80,
  text: 8_000,
  prompt: 32_000,
  runsKept: 20,
  maxRuns: 1_000,
  minEveryMinutes: 1,
  maxEveryMinutes: 7 * 24 * 60,
  maxInMinutes: 365 * 24 * 60,
  onceGraceMs: MINUTE_MS,
  perTask: 20,
  live: 100,
  replayKeys: 500,
  replayTtlMs: 7 * DAY_MS,
  header: 100,
  prefix: 40,
  replayKey: 200,
  secretLabel: 80,
  secretReason: 300,
  detail: 300,
  reference: 200,
  timeZone: 60,
  runAt: 60,
  dailyAt: 5,
  secretRef: 60,
  weekdays: 7,
} as const;

export const SECRET_REF_PATTERN = /^secret-ref:[0-9a-f]{32}$/;

export function isScheduleLive(schedule: Schedule) {
  return schedule.stopped === null;
}
