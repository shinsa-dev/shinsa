import {
  DomainError,
  describeScheduleTarget,
  describeScheduleTrigger,
  type Schedule,
  type ScheduleTarget,
  TASK_PRIORITIES,
  type TaskPriority,
  validateScheduleRequest,
} from '@shinsa/core';
import type { SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import { findTaskId, resolveOptionalRepoId } from './resolve.ts';
import { defineAction, defineCommand, defineRead, encode, readValue, type SurfaceSpec } from './spec.ts';

const SCHEDULE_FIELD: FieldSpec = {
  name: 'schedule',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The schedule id, from `shinsa schedules list`.',
};

interface Webhook {
  url: string;
  signature: { header: string; encoding: string; prefix: string } | null;
  hasSecret: boolean;
  replayKey: string | null;
}

function describeSchedule(schedule: Schedule, titleOf: (taskId: string) => string | null) {
  const state = schedule.stopped ? 'finished' : schedule.enabled ? 'on' : 'paused';
  const next = schedule.nextRunAt ? ` · next ${new Date(schedule.nextRunAt).toISOString()}` : '';
  return `${schedule.id}  ${schedule.name}  (${state}) ${describeScheduleTrigger(schedule.trigger)} · ${describeScheduleTarget(schedule, titleOf)}${next}`;
}

function readWeekdays(values: Values) {
  return ((values.weekdays as string[] | undefined) ?? []).map(Number);
}

function resolveWebhookInput(values: Values) {
  if (!values.webhook) return undefined;
  const header = readValue(values, 'signatureHeader');
  return {
    ...(header
      ? {
          signature: {
            header,
            ...(values.signatureEncoding ? { encoding: values.signatureEncoding } : {}),
            ...(values.signaturePrefix ? { prefix: values.signaturePrefix } : {}),
          },
        }
      : {}),
    ...(values.replayKey ? { replay_key: values.replayKey } : {}),
  };
}

function resolveTrigger(values: Values, now: number) {
  const input = {
    in_minutes: values.inMinutes,
    run_at: values.runAt,
    every_minutes: values.everyMinutes,
    daily_at: values.dailyAt,
    ...(values.weekdays ? { weekdays: readWeekdays(values) } : {}),
    webhook: resolveWebhookInput(values),
  };
  const result = validateScheduleRequest(input, now);
  if (!result.ok) throw new DomainError('schedule_invalid', result.errors.join(' '));
  return result.value.trigger;
}

async function resolveTarget(client: SurfaceClient, values: Values): Promise<ScheduleTarget | null> {
  const task = readValue(values, 'task');
  if (task && values.newTask)
    throw new DomainError('schedule_invalid', 'Give --new-task or --task, not both.');
  if (task) return { kind: 'task', taskId: await findTaskId(client, task) };
  if (!values.newTask) return null;
  return {
    kind: 'new_task',
    repoId: await resolveOptionalRepoId(client, readValue(values, 'repo')),
    priority: (values.priority as TaskPriority | undefined) ?? 'normal',
    mode: values.justAnswer ? 'ask' : 'build',
  };
}

async function resolveTimeZone(client: SurfaceClient, values: Values) {
  const given = readValue(values, 'timeZone');
  if (given) return given;
  const id = readValue(values, 'id');
  if (id) {
    const { schedules } = await client.read<{ schedules: Schedule[] }>('/api/schedules');
    const existing = schedules.find((schedule) => schedule.id === id);
    if (existing) return existing.timeZone;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const SCHEDULE_SPECS: SurfaceSpec[] = [
  defineRead<{ schedules: Schedule[] }>({
    path: ['schedules', 'list'],
    summary: 'List the schedules: what each sends, when, and whether it is on.',
    fields: [],
    request: () => '/api/schedules',
    format: ({ schedules }) =>
      schedules.length === 0
        ? 'No schedules.'
        : schedules.map((schedule) => describeSchedule(schedule, () => null)).join('\n'),
  }),
  defineCommand({
    path: ['schedules', 'write'],
    summary:
      'Create a schedule, or change one with --id: it starts a new task or messages a task once, on an interval, daily or when its webhook is called.',
    command: 'schedule.write',
    fields: [
      { name: 'id', kind: 'text', description: 'The schedule to change. Leave out to create one.' },
      { name: 'name', kind: 'text', description: 'A short name.' },
      {
        name: 'message',
        kind: 'text',
        description:
          'What it sends: the request of the new task, or the message. A webhook may use {{body.path}}.',
      },
      { name: 'inMinutes', kind: 'integer', description: 'Once, this many minutes from now.' },
      { name: 'runAt', kind: 'text', description: 'Once, at this ISO 8601 time.' },
      { name: 'everyMinutes', kind: 'integer', description: 'Repeatedly, every this many minutes.' },
      { name: 'dailyAt', kind: 'text', description: 'Every day at this 24-hour HH:MM.' },
      { name: 'weekdays', kind: 'list', description: 'With --daily-at: only these days, 0 for Sunday.' },
      { name: 'webhook', kind: 'boolean', description: 'Run when its webhook URL is called.' },
      {
        name: 'signatureHeader',
        kind: 'text',
        description: 'With --webhook: the header carrying an HMAC-SHA256 signature.',
      },
      {
        name: 'signatureEncoding',
        kind: 'choice',
        choices: ['hex', 'base64'],
        description: 'hex (the default) or base64.',
      },
      { name: 'signaturePrefix', kind: 'text', description: 'Text before the signature, such as sha256=.' },
      {
        name: 'replayKey',
        kind: 'text',
        description: 'With --webhook: a template that names a delivery, so a repeat starts nothing.',
      },
      { name: 'newTask', kind: 'boolean', description: 'Start a new task on each run.' },
      { name: 'repo', kind: 'text', description: 'With --new-task: the repository (name or id).' },
      {
        name: 'priority',
        kind: 'choice',
        choices: TASK_PRIORITIES,
        description: 'With --new-task: its priority.',
      },
      { name: 'justAnswer', kind: 'boolean', description: 'With --new-task: only answer a question.' },
      { name: 'task', kind: 'text', description: 'Message this task on each run instead.' },
      { name: 'enabled', kind: 'boolean', description: 'false saves it paused.' },
      { name: 'maxRuns', kind: 'integer', description: 'Stop after this many runs.' },
      {
        name: 'timeZone',
        kind: 'text',
        description: 'IANA time zone for --daily-at. The machine’s by default.',
      },
    ],
    build: async (values, client) => ({
      type: 'schedule.write',
      scheduleId: readValue(values, 'id') || null,
      name: readValue(values, 'name') || null,
      text: readValue(values, 'message') || null,
      trigger: resolveTrigger(values, Date.now()),
      target: await resolveTarget(client, values),
      enabled: typeof values.enabled === 'boolean' ? values.enabled : null,
      maxRuns: typeof values.maxRuns === 'number' ? values.maxRuns : null,
      timeZone: await resolveTimeZone(client, values),
    }),
    done: (values) =>
      values.id ? 'Saved the schedule.' : 'Created the schedule. `shinsa schedules list` shows it.',
  }),
  defineCommand({
    path: ['schedules', 'enable'],
    summary: 'Turn a paused schedule back on.',
    command: 'schedule.enable',
    fields: [SCHEDULE_FIELD],
    build: (values) => ({
      type: 'schedule.enable',
      scheduleId: readValue(values, 'schedule'),
      enabled: true,
    }),
    done: () => 'Resumed.',
  }),
  defineCommand({
    path: ['schedules', 'disable'],
    summary: 'Pause a schedule.',
    command: 'schedule.enable',
    fields: [SCHEDULE_FIELD],
    build: (values) => ({
      type: 'schedule.enable',
      scheduleId: readValue(values, 'schedule'),
      enabled: false,
    }),
    done: () => 'Paused.',
  }),
  defineCommand({
    path: ['schedules', 'delete'],
    summary: 'Delete a schedule. A webhook schedule’s URL stops working.',
    command: 'schedule.remove',
    fields: [SCHEDULE_FIELD],
    build: (values) => ({ type: 'schedule.remove', scheduleId: readValue(values, 'schedule') }),
    done: () => 'Deleted.',
  }),
  defineRead<Webhook>({
    path: ['schedules', 'webhook'],
    summary: "Show a webhook schedule's URL and its signature check.",
    fields: [SCHEDULE_FIELD],
    request: (values) => `/api/schedules/${encode(values.schedule)}/webhook`,
    format: (hook) =>
      [
        hook.url,
        hook.signature
          ? `Signature: ${hook.signature.header} (${hook.signature.encoding}${hook.signature.prefix ? `, prefix ${hook.signature.prefix}` : ''}), secret ${hook.hasSecret ? 'set' : 'missing'}`
          : 'No signature check.',
      ].join('\n'),
  }),
  defineAction({
    path: ['schedules', 'webhook-secret'],
    summary:
      "Set the signing secret a webhook schedule checks requests against. It stays in Shinsa's secret store.",
    humanOnly: true,
    fields: [
      SCHEDULE_FIELD,
      { name: 'secret', kind: 'text', positional: 'one', required: true, description: 'The signing secret.' },
    ],
    act: async (client, values) => {
      const data = await client.post(`/api/schedules/${encode(values.schedule)}/webhook`, {
        secret: readValue(values, 'secret'),
      });
      return { data, text: 'Saved the signing secret.' };
    },
  }),
];
