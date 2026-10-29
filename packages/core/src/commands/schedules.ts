import type {
  ScheduleSource,
  ScheduleTarget,
  ScheduleTrigger,
  TaskMode,
  TaskPriority,
} from '../domain/index.ts';

export type ScheduleTargetInput =
  | { kind: 'new_task'; priority: TaskPriority; mode: TaskMode }
  | { kind: 'task'; taskId: string | null };

export type ScheduleUserCommand =
  | { type: 'schedule.enable'; scheduleId: string; enabled: boolean }
  | { type: 'schedule.remove'; scheduleId: string }
  | {
      type: 'schedule.write';
      scheduleId: string | null;
      name: string | null;
      text: string | null;
      trigger: ScheduleTrigger | null;
      target: ScheduleTarget | null;
      source: ScheduleSource | null;
      enabled: boolean | null;
      maxRuns: number | null;
      timeZone: string;
    };

export type ScheduleAgentCommand =
  | {
      type: 'agent.set_schedule';
      runId: string;
      scheduleId: string | null;
      name: string | null;
      text: string | null;
      trigger: ScheduleTrigger | null;
      target: ScheduleTargetInput | null;
      source: string | null;
      enabled: boolean | null;
      maxRuns: number | null;
      timeZone: string;
    }
  | { type: 'agent.delete_schedule'; runId: string; scheduleId: string }
  | { type: 'agent.report_intake'; runId: string; summary: string };

export type ScheduleSystemCommand =
  | { type: 'schedule.fire'; scheduleId: string; dueAt: number }
  | {
      type: 'schedule.fail';
      scheduleId: string;
      dueAt: number | null;
      deliveryId: string | null;
      detail: string;
    }
  | {
      type: 'schedule.deliver';
      scheduleId: string;
      deliveryId: string;
      text: string;
      replayKey: string | null;
    };
