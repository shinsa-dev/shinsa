import {
  DomainError,
  describeScheduleTarget,
  describeScheduleTrigger,
  type Schedule,
  type ScheduleTarget,
  TASK_PRIORITIES,
  type TaskPriority,
  validateScheduleRequest,
  type WatchSuggestion,
} from '@shinsa/core';
import type { CommandReceipt, SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';
import { findProjectId, findTaskId, resolveOptionalRepoId } from './resolve.ts';
import { defineAction, defineCommand, defineRead, readValue, type SurfaceSpec } from './spec.ts';

const SCHEDULE_FIELD: FieldSpec = {
  name: 'schedule',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The schedule id, from `shinsa schedules list`.',
};

const SUGGESTION_FIELD: FieldSpec = {
  name: 'suggestion',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The suggested watch, from `shinsa schedules suggestions`.',
};

function describeSchedule(schedule: Schedule, titleOf: (taskId: string) => string | null) {
  const state = schedule.stopped ? 'finished' : schedule.enabled ? 'on' : 'paused';
  const next = schedule.nextRunAt ? ` · next ${new Date(schedule.nextRunAt).toISOString()}` : '';
  return `${schedule.id}  ${schedule.name}  (${state}) ${describeScheduleTrigger(schedule.trigger)} · ${describeScheduleTarget(schedule, titleOf)}${next}`;
}

function describeSuggestion(suggestion: WatchSuggestion) {
  return `${suggestion.id}  ${suggestion.name}  (${suggestion.server}) ${describeScheduleTrigger(suggestion.trigger)} · ${suggestion.text}`;
}

function readWeekdays(values: Values) {
  return ((values.weekdays as string[] | undefined) ?? []).map(Number);
}

function resolveWebhookInput(values: Values) {
  if (!values.webhook) return undefined;
  const header = readValue(values, 'signatureHeader');
  const secretRef = readValue(values, 'signatureSecretRef');
  return {
    ...(header
      ? {
          signature: {
            header,
            ...(values.signatureEncoding ? { encoding: values.signatureEncoding } : {}),
            ...(values.signaturePrefix ? { prefix: values.signaturePrefix } : {}),
            ...(secretRef ? { secret_ref: secretRef } : {}),
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
  if (!result.ok) throw new DomainError({ code: 'schedule_invalid', message: result.errors.join(' ') });
  return result.value.trigger;
}

async function resolveTarget(client: SurfaceClient, values: Values): Promise<ScheduleTarget | null> {
  const task = readValue(values, 'task');
  if (task && values.newTask)
    throw new DomainError({ code: 'schedule_invalid', message: 'Give --new-task or --task, not both.' });
  if (task) return { kind: 'task', taskId: await findTaskId(client, task) };
  if (!values.newTask) return null;
  return {
    kind: 'new_task',
    repoId: await resolveOptionalRepoId(client, readValue(values, 'repo')),
    priority: (values.priority as TaskPriority | undefined) ?? 'normal',
    mode: values.justAnswer ? 'ask' : 'build',
  };
}

function assertHookSecret(client: SurfaceClient, values: Values) {
  const ref = readValue(values, 'signatureSecretRef');
  const signed = Boolean(values.webhook && readValue(values, 'signatureHeader'));
  if (ref && !client.hookSecrets) {
    throw new DomainError({
      code: 'schedule_invalid',
      message:
        '--signature-secret-ref is for agents. Set the signing secret with `shinsa schedules webhook-secret`.',
    });
  }
  if (ref && !signed) {
    throw new DomainError({
      code: 'schedule_invalid',
      message: 'Give --signature-secret-ref with --webhook and --signature-header.',
    });
  }
  if (signed) client.hookSecrets?.assertSecret(readValue(values, 'id') || null, ref || null);
}

function writeHookSecret(values: Values, receipt: CommandReceipt, client: SurfaceClient) {
  const ref = readValue(values, 'signatureSecretRef');
  const scheduleId = receipt.scheduleId ?? readValue(values, 'id');
  if (!ref || !scheduleId || !client.hookSecrets) return null;
  return client.hookSecrets.writeSecret(scheduleId, ref);
}

async function resolveSource(client: SurfaceClient, values: Values) {
  const server = readValue(values, 'source');
  const project = readValue(values, 'project');
  if (!server) {
    if (project)
      throw new DomainError({ code: 'schedule_invalid', message: 'Give --project only with --source.' });
    return null;
  }
  if (!project) {
    throw new DomainError({
      code: 'schedule_invalid',
      message: 'Name the project whose data source it reads with --project.',
    });
  }
  return { projectId: await findProjectId(client, project), server };
}

async function resolveTimeZone(client: SurfaceClient, values: Values) {
  const given = readValue(values, 'timeZone');
  if (given) return given;
  const id = readValue(values, 'id');
  if (id) {
    const { schedules } = await client.api.state.schedules();
    const existing = schedules.find((schedule) => schedule.id === id);
    if (existing) return existing.timeZone;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const SCHEDULE_SPECS: SurfaceSpec[] = [
  defineRead({
    path: ['schedules', 'list'],
    summary: 'List the schedules: what each sends, when, and whether it is on.',
    fields: [],
    read: (_values, client) => client.api.state.schedules(),
    format: ({ schedules }) =>
      schedules.length === 0
        ? 'No schedules.'
        : schedules.map((schedule) => describeSchedule(schedule, () => null)).join('\n'),
  }),
  defineCommand({
    path: ['schedules', 'write'],
    summary:
      'Create a schedule, or change one with --id: it starts a new task, messages a task or reads a data source, once, on an interval, daily or when its webhook is called.',
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
        name: 'signatureSecretRef',
        kind: 'text',
        description:
          'For an agent: the secret-ref:… that request_secret returned for the signing secret. It works once.',
      },
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
      {
        name: 'source',
        kind: 'text',
        description:
          'Read this data source of the project (its server) on each run and file a task for each new report. Without --task, a task to read it in is created.',
      },
      {
        name: 'project',
        kind: 'text',
        description: 'With --source: the project the data source belongs to.',
      },
      { name: 'enabled', kind: 'boolean', description: 'false saves it paused.' },
      { name: 'maxRuns', kind: 'integer', description: 'Stop after this many runs.' },
      {
        name: 'timeZone',
        kind: 'text',
        description: 'IANA time zone for --daily-at. The machine’s by default.',
      },
    ],
    build: async (values, client) => {
      assertHookSecret(client, values);
      return {
        type: 'schedule.write',
        scheduleId: readValue(values, 'id') || null,
        name: readValue(values, 'name') || null,
        text: readValue(values, 'message') || null,
        trigger: resolveTrigger(values, Date.now()),
        target: await resolveTarget(client, values),
        source: await resolveSource(client, values),
        enabled: typeof values.enabled === 'boolean' ? values.enabled : null,
        maxRuns: typeof values.maxRuns === 'number' ? values.maxRuns : null,
        timeZone: await resolveTimeZone(client, values),
      };
    },
    done: (values) =>
      values.id ? 'Saved the schedule.' : 'Created the schedule. `shinsa schedules list` shows it.',
    after: writeHookSecret,
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
  defineRead({
    path: ['schedules', 'suggestions'],
    summary: 'List the suggested watches that wait for you to accept or dismiss them.',
    fields: [],
    read: (_values, client) => client.api.state.schedules(),
    format: ({ suggestions }) => {
      const open = suggestions.filter((suggestion) => suggestion.status === 'open');
      return open.length === 0 ? 'No suggested watches.' : open.map(describeSuggestion).join('\n');
    },
  }),
  defineCommand({
    path: ['schedules', 'accept'],
    summary: 'Accept a suggested watch: it starts reading its data source on its schedule.',
    command: 'watch_suggestion.accept',
    humanOnly: true,
    fields: [SUGGESTION_FIELD],
    build: (values) => ({ type: 'watch_suggestion.accept', suggestionId: readValue(values, 'suggestion') }),
    done: () => 'Accepted. `shinsa schedules list` shows the watch.',
  }),
  defineCommand({
    path: ['schedules', 'dismiss'],
    summary: 'Dismiss a suggested watch. It is not suggested again.',
    command: 'watch_suggestion.dismiss',
    fields: [SUGGESTION_FIELD],
    build: (values) => ({ type: 'watch_suggestion.dismiss', suggestionId: readValue(values, 'suggestion') }),
    done: () => 'Dismissed.',
  }),
  defineRead({
    path: ['schedules', 'webhook'],
    summary: "Show a webhook schedule's URL and its signature check.",
    fields: [SCHEDULE_FIELD],
    read: (values, client) =>
      client.api.secrets.webhook({ params: { scheduleId: readValue(values, 'schedule') } }),
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
      const data = await client.api.secrets.writeWebhookSecret({
        params: { scheduleId: readValue(values, 'schedule') },
        payload: { secret: readValue(values, 'secret') },
      });
      return { data, text: 'Saved the signing secret.' };
    },
  }),
];
