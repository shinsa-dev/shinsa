import { SCHEDULE_LIMITS, TASK_PRIORITIES } from '@shinsa/core';
import { limitedText, type ToolSpec } from './schema.ts';

const L = SCHEDULE_LIMITS;

const SCHEDULE_ID = {
  type: 'string',
  maxLength: L.reference,
  description: 'The schedule_id that set_schedule or list_schedules returned.',
};

const SIGNATURE = {
  type: 'object',
  description:
    'Check an HMAC-SHA256 signature of the request body before anything runs. Requests that fail the check are refused.',
  properties: {
    header: {
      type: 'string',
      maxLength: L.header,
      description: 'The header that carries it, such as X-Hub-Signature-256.',
    },
    encoding: {
      type: 'string',
      enum: ['hex', 'base64'],
      description: 'How the signature is written. Defaults to hex.',
    },
    prefix: {
      type: 'string',
      maxLength: L.prefix,
      description: 'Text before the signature, such as sha256=.',
    },
    secret_ref: {
      type: 'string',
      maxLength: L.secretRef,
      description:
        'The secret-ref:… that request_secret returned for the signing secret. It works once; never put a secret itself here.',
    },
  },
  required: ['header'],
};

export const SCHEDULE_TOOL_SPECS = {
  set_schedule: {
    name: 'set_schedule',
    description: [
      'Do something later, once or on a repeat: send a message into this task (the default), into another task (task_id), or start a new task each time (new_task) in this repository.',
      'Give exactly one of in_minutes, run_at, every_minutes, daily_at or webhook. Pass schedule_id to change or pause one; anything you leave out stays as it was, and a change that keeps the time keeps the next run.',
      'A run is skipped while the last one is still going, a machine that was asleep runs a missed schedule once when it wakes, and daily times follow the wall clock of time_zone.',
      'For a webhook, message is a template: {{body.path}}, {{headers.name}}, {{query.name}} and {{request}} are filled in from each request and marked as untrusted data. The reply gives the URL to hand to the sender.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        schedule_id: SCHEDULE_ID,
        name: limitedText('What it does in a few words, shown to the human.', L.name),
        message: limitedText(
          'The message to send or the request for the new task, as the human would write it.',
          L.text
        ),
        new_task: { type: 'boolean', description: 'Start a new task in this repository on each run.' },
        just_answer: {
          type: 'boolean',
          description: 'With new_task: each new task only answers a question.',
        },
        priority: {
          type: 'string',
          enum: TASK_PRIORITIES,
          description: 'With new_task.',
        },
        task_id: {
          type: 'string',
          maxLength: L.reference,
          description: 'Message this task instead of your own. find_tasks lists them.',
        },
        in_minutes: {
          type: 'integer',
          minimum: 1,
          maximum: L.maxInMinutes,
          description: 'Once, this many minutes from now.',
        },
        run_at: {
          type: 'string',
          maxLength: L.runAt,
          description: 'Once, at this ISO 8601 time, such as 2026-01-31T09:00:00-08:00.',
        },
        every_minutes: {
          type: 'integer',
          minimum: L.minEveryMinutes,
          maximum: L.maxEveryMinutes,
          description: 'Repeatedly, this often.',
        },
        daily_at: {
          type: 'string',
          maxLength: L.dailyAt,
          description: 'Every day at this 24-hour HH:MM in time_zone.',
        },
        weekdays: {
          type: 'array',
          maxItems: L.weekdays,
          items: { type: 'integer', minimum: 0, maximum: 6 },
          description: 'With daily_at: only these days, 0 for Sunday.',
        },
        webhook: {
          type: 'object',
          description: 'Run when Shinsa’s URL for this schedule is called.',
          properties: {
            signature: SIGNATURE,
            replay_key: {
              type: 'string',
              maxLength: L.replayKey,
              description:
                'A part of the request that is the same when a sender retries, such as {{headers.x-github-delivery}}. A request with a key seen in the last seven days is dropped.',
            },
          },
        },
        enabled: { type: 'boolean', description: 'false pauses it, true resumes it.' },
        max_runs: {
          type: 'integer',
          minimum: 1,
          maximum: L.maxRuns,
          description: 'Stop after this many runs.',
        },
        time_zone: {
          type: 'string',
          maxLength: L.timeZone,
          description:
            'The IANA time zone for daily_at, such as Europe/Berlin. A new schedule defaults to this machine’s; a change keeps the schedule’s own.',
        },
      },
    },
  },
  list_schedules: {
    name: 'list_schedules',
    description: 'List every schedule: what it does, when it runs next, and its last runs.',
    inputSchema: { type: 'object', properties: {} },
  },
  delete_schedule: {
    name: 'delete_schedule',
    description: 'Delete a schedule this task made.',
    inputSchema: { type: 'object', properties: { schedule_id: SCHEDULE_ID }, required: ['schedule_id'] },
  },
  request_secret: {
    name: 'request_secret',
    description: [
      'Ask the human for a secret value, such as a webhook signing secret or an API token. Waits until they answer.',
      'They type it into a secret field; it goes straight to Shinsa’s secret store, and you get back a secret-ref:… to pass where a secret is asked for. The ref works once and expires after a day.',
      'You never see the value, and it never appears in the chat. Never ask for a secret with `ask`.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: {
        label: limitedText('What the secret is, such as “GitHub webhook secret”.', L.secretLabel),
        reason: limitedText(
          'One sentence telling the human what you need it for and where to find it.',
          L.secretReason
        ),
      },
      required: ['label', 'reason'],
    },
  },
} satisfies Record<string, ToolSpec>;
