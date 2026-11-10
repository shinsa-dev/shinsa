import type { ScheduleTargetInput } from '../commands/schedules.ts';
import { MINUTE_MS, type ScheduleTrigger } from '../domain/index.ts';
import { HandOverReader, type Validation } from '../report/reading.ts';
import {
  DailyAt,
  EveryMinutes,
  InMinutes,
  NewTaskTarget,
  ReadReportInput,
  ReportFilingInput,
  RunAt,
  ScheduleNaming,
  ScheduleOptions,
  SecretRequestInput,
  SlackChannelChoice,
  TargetChoice,
  Webhook,
  WHEN_KEYS,
} from './schema.ts';
import { parseTimeOfDay, serializeTimeOfDay } from './time.ts';

export interface SlackChannelRequest {
  channel: string;
  workspace: string | null;
}

export interface ScheduleRequest {
  scheduleId: string | null;
  name: string | null;
  text: string | null;
  trigger: ScheduleTrigger | null;
  slackChannel: SlackChannelRequest | null;
  target: ScheduleTargetInput | null;
  source: string | null;
  enabled: boolean | null;
  maxRuns: number | null;
  timeZone: string | null;
  secretRef: string | null;
  repository: string | null;
}

function readWebhook(reader: HandOverReader, value: unknown): TriggerRead {
  const webhook = reader.read(Webhook, value === true ? {} : value, ['webhook']);
  const { signature } = webhook;
  return {
    trigger: {
      kind: 'webhook',
      signature:
        signature === null
          ? null
          : {
              header: signature.header.toLowerCase(),
              encoding: signature.encoding ?? 'hex',
              prefix: signature.prefix ?? '',
            },
      replayKey: webhook.replay_key,
    },
    secretRef: signature?.secret_ref ?? null,
    slackChannel: null,
  };
}

function readSlackChannel(reader: HandOverReader, input: Record<string, unknown>): TriggerRead {
  const { slack_channel: channel, slack_workspace: workspace } = reader.read(SlackChannelChoice, input, []);
  const name = channel.replace(/^#/, '').trim();
  if (!name) reader.refuse('slack_channel must name a channel, such as #alerts.');
  return { trigger: null, secretRef: null, slackChannel: { channel: name, workspace } };
}

const NO_TRIGGER: TriggerRead = { trigger: null, secretRef: null, slackChannel: null };

function readDaily(reader: HandOverReader, input: Record<string, unknown>): ScheduleTrigger {
  const { daily_at: raw, weekdays } = reader.read(DailyAt, input, []);
  const time = parseTimeOfDay(raw);
  return { kind: 'daily', time: time ? serializeTimeOfDay(time) : raw, weekdays };
}

interface TriggerRead {
  trigger: ScheduleTrigger | null;
  secretRef: string | null;
  slackChannel: SlackChannelRequest | null;
}

function readTrigger(reader: HandOverReader, input: Record<string, unknown>, now: number): TriggerRead {
  const given = WHEN_KEYS.filter(
    (key) => input[key] !== undefined && input[key] !== null && input[key] !== false
  );
  const [when] = given;
  if (when === undefined) return NO_TRIGGER;
  if (given.length > 1) {
    reader.refuse(`Give one of ${WHEN_KEYS.join(', ')}, not several.`);
    return NO_TRIGGER;
  }
  if (input.weekdays !== undefined && when !== 'daily_at') reader.refuse('weekdays only go with daily_at.');
  if (input.slack_workspace !== undefined && input.slack_workspace !== null && when !== 'slack_channel')
    reader.refuse('slack_workspace only goes with slack_channel.');
  switch (when) {
    case 'in_minutes': {
      const minutes = reader.read(InMinutes, input.in_minutes, ['in_minutes']);
      return { ...NO_TRIGGER, trigger: { kind: 'once', at: now + minutes * MINUTE_MS } };
    }
    case 'run_at': {
      const { run_at: text } = reader.read(RunAt, input, []);
      return { ...NO_TRIGGER, trigger: { kind: 'once', at: Date.parse(text) } };
    }
    case 'every_minutes': {
      const everyMinutes = reader.read(EveryMinutes, input.every_minutes, ['every_minutes']);
      return { ...NO_TRIGGER, trigger: { kind: 'interval', everyMinutes } };
    }
    case 'daily_at':
      return { ...NO_TRIGGER, trigger: readDaily(reader, input) };
    case 'webhook':
      return readWebhook(reader, input.webhook);
    case 'slack_channel':
      return readSlackChannel(reader, input);
  }
}

function readTarget(reader: HandOverReader, input: Record<string, unknown>): ScheduleTargetInput | null {
  const { new_task: newTask, task_id: taskId } = reader.read(TargetChoice, input, []);
  if (newTask) {
    const target = reader.read(NewTaskTarget, input, []);
    return {
      kind: 'new_task',
      repoId: null,
      priority: target.priority ?? 'normal',
      mode: target.just_answer ? 'ask' : 'build',
    };
  }
  if (taskId !== null) return { kind: 'task', taskId };
  return null;
}

export function validateScheduleRequest(
  input: Record<string, unknown>,
  now: number
): Validation<ScheduleRequest> {
  const reader = new HandOverReader();
  const { trigger, secretRef, slackChannel } = readTrigger(reader, input, now);
  const naming = reader.read(ScheduleNaming, input, []);
  const target = readTarget(reader, input);
  const options = reader.read(ScheduleOptions, input, []);
  return reader.result({
    scheduleId: naming.schedule_id,
    name: naming.name,
    text: naming.message,
    trigger,
    slackChannel,
    target,
    source: options.source,
    enabled: options.enabled,
    maxRuns: options.max_runs,
    timeZone: options.time_zone,
    secretRef,
    repository: options.repository,
  });
}

export function validateReadReport(
  input: Record<string, unknown>
): Validation<{ summary: string; reached: boolean; live: boolean | null }> {
  const reader = new HandOverReader();
  const report = reader.read(ReadReportInput, input, []);
  return reader.result({ summary: report.summary, reached: report.reached ?? true, live: report.live });
}

export interface ReportFilingRequest {
  title: string;
  request: string;
  reportId: string | null;
  link: string | null;
  author: string | null;
  postedAt: string | null;
  text: string;
  forkFrom: string | null;
  repository: string | null;
}

export function validateReportFiling(input: Record<string, unknown>): Validation<ReportFilingRequest> {
  const reader = new HandOverReader();
  const filing = reader.read(ReportFilingInput, input, []);
  return reader.result({
    title: filing.title,
    request: filing.request,
    reportId: filing.report_id,
    link: filing.link,
    author: filing.author,
    postedAt: filing.posted_at,
    text: filing.text,
    forkFrom: filing.fork_from,
    repository: filing.repository,
  });
}

export function validateSecretRequest(
  input: Record<string, unknown>
): Validation<{ label: string; reason: string }> {
  const reader = new HandOverReader();
  return reader.result(reader.read(SecretRequestInput, input, []));
}
