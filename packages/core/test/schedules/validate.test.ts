import { describe, expect, test } from 'bun:test';
import {
  SCHEDULE_LIMITS,
  validateReadReport,
  validateReportFiling,
  validateScheduleRequest,
  validateSecretRequest,
} from '../../src/index.ts';

const NOW = Date.parse('2026-10-23T12:00:00Z');

const REF = `secret-ref:${'0'.repeat(32)}`;

function read(input: Record<string, unknown>) {
  return validateScheduleRequest(input, NOW);
}

function errorsOf(input: Record<string, unknown>) {
  const result = read(input);
  return result.ok ? [] : result.errors;
}

describe('reading set_schedule', () => {
  test('an empty call changes nothing', () => {
    expect(read({})).toEqual({
      ok: true,
      value: {
        scheduleId: null,
        name: null,
        text: null,
        trigger: null,
        target: null,
        source: null,
        enabled: null,
        maxRuns: null,
        timeZone: null,
        secretRef: null,
      },
    });
  });

  test('in_minutes counts from now', () => {
    const result = read({ in_minutes: 5, message: 'Ping', name: 'Ping', time_zone: 'UTC', max_runs: 2 });
    expect(result).toMatchObject({
      ok: true,
      value: {
        trigger: { kind: 'once', at: NOW + 5 * 60_000 },
        text: 'Ping',
        name: 'Ping',
        timeZone: 'UTC',
        maxRuns: 2,
      },
    });
  });

  test('run_at, every_minutes and daily_at with weekdays', () => {
    expect(read({ run_at: '2026-10-24T09:00:00Z' })).toMatchObject({
      value: { trigger: { kind: 'once', at: Date.parse('2026-10-24T09:00:00Z') } },
    });
    expect(read({ every_minutes: 45 })).toMatchObject({
      value: { trigger: { kind: 'interval', everyMinutes: 45 } },
    });
    expect(read({ daily_at: '9:00', weekdays: [1, 3] })).toMatchObject({
      value: { trigger: { kind: 'daily', time: '09:00', weekdays: [1, 3] } },
    });
  });

  test('a webhook with a signature and a replay key', () => {
    expect(
      read({
        webhook: {
          signature: { header: 'X-Hub-Signature-256', prefix: 'sha256=', secret_ref: REF },
          replay_key: '{{headers.x-github-delivery}}',
        },
      })
    ).toMatchObject({
      value: {
        trigger: {
          kind: 'webhook',
          signature: { header: 'x-hub-signature-256', encoding: 'hex', prefix: 'sha256=' },
          replayKey: '{{headers.x-github-delivery}}',
        },
        secretRef: REF,
      },
    });
    expect(read({ webhook: true })).toMatchObject({
      value: { trigger: { kind: 'webhook', signature: null, replayKey: null }, secretRef: null },
    });
    expect(read({ webhook: { signature: { header: 'x-sig', encoding: 'base64' } } })).toMatchObject({
      value: { trigger: { signature: { encoding: 'base64', prefix: '' } }, secretRef: null },
    });
  });

  test('targets: a new task, a question, another task', () => {
    expect(read({ new_task: true })).toMatchObject({
      value: { target: { kind: 'new_task', priority: 'normal', mode: 'build' } },
    });
    expect(read({ new_task: true, priority: 'high', just_answer: true })).toMatchObject({
      value: { target: { kind: 'new_task', priority: 'high', mode: 'ask' } },
    });
    expect(read({ task_id: 't1' })).toMatchObject({ value: { target: { kind: 'task', taskId: 't1' } } });
    expect(read({ enabled: false })).toMatchObject({ value: { enabled: false } });
  });

  test.each<[string, Record<string, unknown>, string]>([
    ['several times', { in_minutes: 5, every_minutes: 5 }, 'not several'],
    ['weekdays without a daily time', { every_minutes: 5, weekdays: [1] }, 'weekdays only go with daily_at'],
    ['a weekday out of range', { daily_at: '09:00', weekdays: [8] }, 'weekdays[0] must be'],
    ['a made-up time of day', { daily_at: '9pm' }, 'is not a time of day'],
    ['a time that is not a time', { run_at: 'tomorrow' }, 'is not a time'],
    ['a bad ref', { webhook: { signature: { header: 'x', secret_ref: 'abc' } } }, 'secret-ref'],
    ['both targets', { new_task: true, task_id: 't' }, 'not both'],
    ['zero minutes', { in_minutes: 0 }, 'in_minutes must be'],
  ])('refuses %s', (_name, input, message) => {
    expect(errorsOf(input).join(' ')).toContain(message);
  });
});

describe('reading request_secret', () => {
  test('needs a label and a reason', () => {
    expect(validateSecretRequest({ label: 'Token', reason: 'For the webhook.' })).toEqual({
      ok: true,
      value: { label: 'Token', reason: 'For the webhook.' },
    });
    expect(validateSecretRequest({})).toEqual({
      ok: false,
      errors: ['label is required.', 'reason is required.'],
    });
  });
});

describe('a report to file', () => {
  const report = {
    title: 'Editor loses edits',
    request: 'Keep unsaved edits.',
    text: 'I lost my edits.',
  };

  test('reads every field, the optional ones as null when left out', () => {
    expect(validateReportFiling({ ...report, link: 'https://slack.com/p1' })).toEqual({
      ok: true,
      value: {
        ...report,
        reportId: null,
        link: 'https://slack.com/p1',
        author: null,
        postedAt: null,
        forkFrom: null,
        repository: null,
      },
    });
    expect(
      validateReportFiling({
        ...report,
        report_id: '17.1',
        author: 'Dana',
        posted_at: '2026-10-29T10:00:00Z',
        fork_from: 'LOC-14',
        repository: 'shinsa',
      })
    ).toMatchObject({
      ok: true,
      value: {
        reportId: '17.1',
        author: 'Dana',
        postedAt: '2026-10-29T10:00:00Z',
        forkFrom: 'LOC-14',
        repository: 'shinsa',
      },
    });
  });

  test('needs the report’s id or link, and keeps every text within its limit', () => {
    const unnamed = validateReportFiling(report);
    expect(unnamed.ok).toBe(false);
    expect(unnamed.ok ? [] : unnamed.errors).toContain(
      'Give the report’s report_id or link in the source, so Shinsa never files it twice.'
    );
    const long = validateReportFiling({
      ...report,
      link: 'l',
      text: 'x'.repeat(SCHEDULE_LIMITS.reportText + 1),
    });
    expect(long.ok).toBe(false);
  });
});

describe('a read of a data source to report', () => {
  test('needs a summary within its limit', () => {
    expect(validateReadReport({ summary: 'Filed 2.' })).toEqual({
      ok: true,
      value: { summary: 'Filed 2.', reached: true, live: null },
    });
    expect(validateReadReport({ summary: 'It timed out.', reached: false })).toEqual({
      ok: true,
      value: { summary: 'It timed out.', reached: false, live: null },
    });
    expect(validateReadReport({ summary: 'Filed 2.', reached: 'no' }).ok).toBe(false);
    expect(validateReadReport({ summary: 'x'.repeat(SCHEDULE_LIMITS.readSummary + 1) }).ok).toBe(false);
  });

  test('takes live for a watchdog that waits for production', () => {
    expect(validateReadReport({ summary: 'Not live yet.', live: false })).toEqual({
      ok: true,
      value: { summary: 'Not live yet.', reached: true, live: false },
    });
    expect(validateReadReport({ summary: 'Live.', live: 'yes' }).ok).toBe(false);
  });
});
