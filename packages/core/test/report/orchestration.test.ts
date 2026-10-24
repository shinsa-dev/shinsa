import { describe, expect, test } from 'bun:test';
import {
  validateCourierTask,
  validateDelegationAnswer,
  validateDelegationReference,
  validateDelegationRequest,
  validateSplit,
} from '../../src/index.ts';

describe('validateDelegationRequest', () => {
  test('fills in the defaults: async, shared, ten minutes, the title from the brief', () => {
    expect(validateDelegationRequest({ brief: 'Read src/a.ts and list the exports.\nThen stop.' })).toEqual({
      ok: true,
      value: {
        brief: 'Read src/a.ts and list the exports.\nThen stop.',
        title: 'Read src/a.ts and list the exports.',
        role: null,
        mode: 'async',
        isolation: 'shared',
        timeoutMinutes: 10,
        requestKey: null,
        provider: null,
        model: null,
      },
    });
  });

  test('takes every field it knows', () => {
    expect(
      validateDelegationRequest({
        brief: 'Review the diff.',
        title: 'Review round 2',
        role: 'reviewer',
        mode: 'wait',
        isolation: 'worktree',
        timeout_minutes: 30,
        client_request_id: 'review-2',
        provider: 'claude',
        model: 'opus',
      })
    ).toEqual({
      ok: true,
      value: {
        brief: 'Review the diff.',
        title: 'Review round 2',
        role: 'reviewer',
        mode: 'wait',
        isolation: 'worktree',
        timeoutMinutes: 30,
        requestKey: 'review-2',
        provider: 'claude',
        model: 'opus',
      },
    });
  });

  test('shortens a long first line into a title', () => {
    const result = validateDelegationRequest({ brief: 'x'.repeat(200) });
    expect(result.ok && result.value.title).toBe(`${'x'.repeat(79)}…`);
  });

  test('says what is wrong with each field', () => {
    expect(
      validateDelegationRequest({
        brief: '',
        role: 'answerer',
        mode: 'later',
        isolation: 'vm',
        timeout_minutes: 90,
      })
    ).toEqual({
      ok: false,
      errors: [
        'brief is required.',
        'role must be one of planner, builder, reviewer.',
        'mode must be one of async, wait.',
        'isolation must be one of shared, worktree.',
        'timeout_minutes must be a whole number from 1 to 60.',
      ],
    });
  });
});

describe('the other orchestration tools', () => {
  test('a delegation id is required, and an answer needs words', () => {
    expect(validateDelegationReference({ delegation_id: 'r1' })).toEqual({
      ok: true,
      value: { delegationId: 'r1' },
    });
    expect(validateDelegationReference({})).toEqual({ ok: false, errors: ['delegation_id is required.'] });
    expect(validateDelegationAnswer({ delegation_id: 'r1', answer: 'Yes.' })).toEqual({
      ok: true,
      value: { delegationId: 'r1', answer: 'Yes.' },
    });
    expect(validateDelegationAnswer({ delegation_id: 'r1' })).toEqual({
      ok: false,
      errors: ['answer is required.'],
    });
  });

  test('a courier task is a request that stands on its own', () => {
    expect(validateCourierTask({ request: 'Do it.', this_task_waits: true, repository: 'admin' })).toEqual({
      ok: true,
      value: { request: 'Do it.', requestKey: null, repository: 'admin', thisTaskWaits: true },
    });
    expect(validateCourierTask({})).toEqual({ ok: false, errors: ['request is required.'] });
  });

  test('a split is one to eight requests', () => {
    expect(validateSplit({ tasks: [{ request: 'A.' }, { request: 'B.' }] })).toEqual({
      ok: true,
      value: { requests: ['A.', 'B.'], thisTaskWaits: false },
    });
    expect(validateSplit({ tasks: [] })).toEqual({ ok: false, errors: ['tasks needs at least 1 item.'] });
  });
});
