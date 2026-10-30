import { MINUTE_MS } from '@shinsa/core';
import type { FieldSpec } from './fields.ts';
import { findTaskId, readTask, type TaskDetail } from './resolve.ts';
import { defineCommand, defineRead, encode, readValue, type SurfaceSpec } from './spec.ts';
import { TASK_FIELD } from './tasks.ts';

const RUN_FIELD: FieldSpec = {
  name: 'run',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The run id, from `shinsa tasks show --json` or `shinsa delegations list`.',
};

const SUGGESTION_FIELD: FieldSpec = {
  name: 'suggestion',
  kind: 'text',
  positional: 'one',
  required: true,
  description: 'The suggested task id, from `shinsa suggestions list`.',
};

const SNOOZE_MINUTES = 30;

interface DelegationView {
  id: string;
  taskId: string;
  role: string;
  outcome: string | null;
  endedAt: number | null;
  delegation: { title: string } | null;
}

export const WORK_SPECS: SurfaceSpec[] = [
  defineRead<TaskDetail>({
    path: ['suggestions', 'list'],
    summary: 'List the tasks agents suggested on a task.',
    fields: [TASK_FIELD],
    request: (values) => `/api/tasks/${encode(values.task)}`,
    format: ({ suggestions }) =>
      suggestions.length === 0
        ? 'No suggested tasks.'
        : suggestions
            .map(
              (suggestion) =>
                `${suggestion.id}  ${suggestion.title}  (${suggestion.status}) ${suggestion.why}`
            )
            .join('\n'),
  }),
  defineCommand({
    path: ['suggestions', 'accept'],
    summary: 'Add a suggested task as a task of its own.',
    command: 'suggestion.accept',
    fields: [
      TASK_FIELD,
      SUGGESTION_FIELD,
      { name: 'afterThis', kind: 'boolean', description: 'Start it only after this task merges.' },
    ],
    build: async (values, client) => ({
      type: 'suggestion.accept',
      taskId: await findTaskId(client, readValue(values, 'task')),
      suggestionId: readValue(values, 'suggestion'),
      waitsOnThis: values.afterThis === true,
    }),
    done: () => 'Added the suggested task.',
  }),
  defineCommand({
    path: ['suggestions', 'dismiss'],
    summary: 'Dismiss a suggested task.',
    command: 'suggestion.dismiss',
    fields: [TASK_FIELD, SUGGESTION_FIELD],
    build: async (values, client) => ({
      type: 'suggestion.dismiss',
      taskId: (await readTask(client, readValue(values, 'task'))).task.id,
      suggestionId: readValue(values, 'suggestion'),
    }),
    done: () => 'Dismissed.',
  }),
  defineCommand({
    path: ['suggestions', 'keep'],
    summary: 'Keep a suggested task in this task instead: it goes to the agent now.',
    command: 'suggestion.keep',
    fields: [TASK_FIELD, SUGGESTION_FIELD],
    build: async (values, client) => ({
      type: 'suggestion.keep',
      taskId: await findTaskId(client, readValue(values, 'task')),
      suggestionId: readValue(values, 'suggestion'),
    }),
    done: () => 'Kept it in this task as a new round.',
  }),
  defineCommand({
    path: ['runs', 'snooze'],
    summary: 'Snooze the warning about an agent that has gone quiet.',
    command: 'run.snooze_silence',
    fields: [
      RUN_FIELD,
      {
        name: 'minutes',
        kind: 'integer',
        description: `For this many minutes (${SNOOZE_MINUTES} by default).`,
      },
    ],
    build: (values) => ({
      type: 'run.snooze_silence',
      runId: readValue(values, 'run'),
      until: Date.now() + ((values.minutes as number | undefined) ?? SNOOZE_MINUTES) * MINUTE_MS,
    }),
    done: () => 'Snoozed.',
  }),
  defineCommand({
    path: ['runs', 'dismiss'],
    summary: 'Dismiss the quiet-agent warning for the rest of a run.',
    command: 'run.dismiss_silence',
    fields: [RUN_FIELD],
    build: (values) => ({ type: 'run.dismiss_silence', runId: readValue(values, 'run') }),
    done: () => 'Dismissed.',
  }),
  defineRead<{ delegations: DelegationView[] }>({
    path: ['delegations', 'list'],
    summary: 'List the delegations: work agents handed to other agents.',
    fields: [
      { name: 'task', kind: 'text', description: 'Only this task (id, start of the id, or exact title).' },
    ],
    request: (values) => (values.task ? `/api/delegations?task=${encode(values.task)}` : '/api/delegations'),
    format: ({ delegations }) =>
      delegations.length === 0
        ? 'No delegations.'
        : delegations
            .map(
              (run) =>
                `${run.id}  ${run.role}  ${run.delegation?.title ?? ''}  (${run.endedAt ? (run.outcome ?? 'ended') : 'working'}) on task ${run.taskId}`
            )
            .join('\n'),
  }),
  defineCommand({
    path: ['delegations', 'stop'],
    summary: 'Stop a delegation and every delegation it started.',
    command: 'delegation.cancel',
    fields: [RUN_FIELD],
    build: (values) => ({ type: 'delegation.cancel', runId: readValue(values, 'run') }),
    done: () => 'Stopped.',
  }),
];
