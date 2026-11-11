import type { ScheduleTrigger, TaskMode, TaskPriority } from '../domain/index.ts';
import type { SlackMessageRef } from '../domain/slack.ts';

export interface ReportFiling {
  title: string;
  request: string;
  reportId: string | null;
  link: string | null;
  author: string | null;
  postedAt: string | null;
  text: string;
  forkOf: string | null;
  repoId: string | null;
  urgency: TaskPriority | null;
}

export type ScheduleTargetInput =
  | { kind: 'new_task'; repoId: string | null; priority: TaskPriority; mode: TaskMode }
  | { kind: 'task'; taskId: string | null };

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
  | { type: 'agent.report_read'; runId: string; summary: string; reached: boolean; live?: boolean | null }
  | ({ type: 'agent.file_report'; runId: string } & ReportFiling);

export type ScheduleSystemCommand =
  | { type: 'schedule.fire'; scheduleId: string; dueAt: number }
  | {
      type: 'watch_suggestion.record';
      projectId: string;
      server: string;
      name: string | null;
      text: string | null;
      timeZone: string;
    }
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
      slackMessage?: SlackMessageRef | null;
    }
  | {
      type: 'schedule.skip';
      scheduleId: string;
      deliveryId: string;
      detail: string;
      replayKey: string | null;
    };
