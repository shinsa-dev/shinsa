import { describe, expect, test } from 'bun:test';
import { createFakeClient, createTaskDetail, runSpec } from './fixtures.ts';

function gate(id: string, kind: string, purpose: string, extra: Record<string, unknown> = {}) {
  return { id, taskId: 'task-123', kind, purpose, status: 'open', title: id, ...extra };
}

const OPEN = createTaskDetail({
  gates: [
    gate('gate-plan', 'spec', 'decision', { planVersion: 2 }),
    gate('gate-review', 'review', 'decision'),
    gate('gate-merge', 'merge', 'decision'),
    gate('gate-secret', 'question', 'agent_question', { secret: { name: 'TOKEN' } }),
    gate('gate-question', 'question', 'agent_question'),
    gate('gate-operation', 'question', 'operation'),
  ],
});

const NONE = createTaskDetail({ gates: [gate('gate-other', 'failure', 'decision')] });

function createClient(detail = OPEN) {
  return createFakeClient({
    '/api/tasks/fix': detail,
    '/api/secrets/gate-secret': { ok: true },
  });
}

describe('answering a gate by id', () => {
  test('sends the decision with the response, plan version and verdicts it was given', async () => {
    const fake = createClient();
    const result = await runSpec(fake, [
      'gates',
      'answer',
      'gate-review',
      '--decision',
      'revise',
      '--response',
      'Keep the old API.',
      '--plan-version',
      '3',
      '--verdicts',
      '[{"index":0,"verdict":"fix","note":null}]',
    ]);
    expect(fake.sent).toEqual([
      {
        type: 'gate.answer',
        gateId: 'gate-review',
        decision: 'revise',
        response: 'Keep the old API.',
        planVersion: 3,
        verdicts: [{ index: 0, verdict: 'fix', note: null }],
      },
    ]);
    expect(result.text).toBe('Asked for changes. A fixer picks it up.');
  });

  test('without a response it sends none', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['gates', 'answer', 'gate-merge', '--decision', 'reject'])).text).toBe(
      'Rejected.'
    );
    expect(fake.sent).toEqual([
      { type: 'gate.answer', gateId: 'gate-merge', decision: 'reject', response: null },
    ]);
  });
});

describe('the gate shortcuts', () => {
  const cases: [string[], Record<string, unknown>, string][] = [
    [
      ['plans', 'approve', 'fix'],
      { gateId: 'gate-plan', decision: 'approve', response: null, planVersion: 2 },
      'Approved.',
    ],
    [
      ['plans', 'revise', 'fix', 'split', 'phase', 'two'],
      { gateId: 'gate-plan', decision: 'revise', response: 'split phase two', planVersion: 2 },
      'Asked for changes. A fixer picks it up.',
    ],
    [
      ['plans', 'reject', 'fix'],
      { gateId: 'gate-plan', decision: 'reject', response: null, planVersion: 2 },
      'Rejected.',
    ],
    [
      ['reviews', 'approve', 'fix'],
      { gateId: 'gate-review', decision: 'approve', response: null },
      'Approved.',
    ],
    [
      ['reviews', 'revise', 'fix', 'rename', 'it'],
      { gateId: 'gate-review', decision: 'revise', response: 'rename it' },
      'Asked for changes. A fixer picks it up.',
    ],
    [
      ['reviews', 'reject', 'fix'],
      { gateId: 'gate-review', decision: 'reject', response: null },
      'Rejected.',
    ],
    [
      ['merges', 'approve', 'fix'],
      { gateId: 'gate-merge', decision: 'approve', response: null },
      'Approved.',
    ],
    [['merges', 'reject', 'fix'], { gateId: 'gate-merge', decision: 'reject', response: null }, 'Rejected.'],
    [
      ['operations', 'run', 'fix'],
      { gateId: 'gate-operation', decision: 'approve', response: null },
      'Running the operation.',
    ],
    [
      ['operations', 'run', 'fix', 'staging', 'first'],
      { gateId: 'gate-operation', decision: 'answer', response: 'staging first' },
      'Running the operation with your notes.',
    ],
    [
      ['operations', 'finish', 'fix'],
      { gateId: 'gate-operation', decision: 'reject', response: null },
      'Finished without running the operation.',
    ],
    [
      ['questions', 'answer', 'fix', 'blue'],
      { gateId: 'gate-question', decision: 'answer', response: 'blue' },
      'Answered. The agent carries on.',
    ],
  ];

  for (const [words, fields, text] of cases) {
    test(`shinsa ${words.slice(0, 2).join(' ')} answers the open ${String(fields.gateId).slice(5)} gate`, async () => {
      const fake = createClient();
      expect((await runSpec(fake, words)).text).toBe(text);
      expect(fake.sent).toEqual([{ type: 'gate.answer', ...fields } as never]);
    });
  }

  test('a task with no such gate open is refused, naming the task', async () => {
    const fake = createClient(NONE);
    await expect(runSpec(fake, ['plans', 'approve', 'fix'])).rejects.toThrow(
      '“Fix the tab scroll” has no plan to approve waiting.'
    );
    await expect(runSpec(fake, ['questions', 'answer', 'fix', 'x'])).rejects.toThrow(
      '“Fix the tab scroll” has no question from an agent waiting.'
    );
    await expect(runSpec(fake, ['operations', 'run', 'fix'])).rejects.toThrow(
      '“Fix the tab scroll” has no operation to confirm waiting.'
    );
    expect(fake.sent).toEqual([]);
  });
});

describe('review verdicts', () => {
  test('a finding to fix asks for changes with the note; dismissing them all approves', async () => {
    const fake = createClient();
    await runSpec(fake, [
      'reviews',
      'verdicts',
      'fix',
      '--fix',
      '0,2',
      '--dismiss',
      '1',
      '--note',
      'Keep it small.',
    ]);
    await runSpec(fake, ['reviews', 'verdicts', 'fix', '--dismiss', '0']);
    expect(fake.sent).toEqual([
      {
        type: 'gate.answer',
        gateId: 'gate-review',
        decision: 'revise',
        response: null,
        verdicts: [
          { index: 0, verdict: 'fix', note: 'Keep it small.' },
          { index: 2, verdict: 'fix', note: 'Keep it small.' },
          { index: 1, verdict: 'dismiss', note: null },
        ],
      },
      {
        type: 'gate.answer',
        gateId: 'gate-review',
        decision: 'approve',
        response: null,
        verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
      },
    ]);
  });

  test('a finding number that is not a whole number from 0 is refused', async () => {
    const fake = createClient();
    await expect(runSpec(fake, ['reviews', 'verdicts', 'fix', '--fix', 'first'])).rejects.toThrow(
      'first is not a finding number.'
    );
    await expect(runSpec(fake, ['reviews', 'verdicts', 'fix', '--dismiss', '-1'])).rejects.toThrow(
      '-1 is not a finding number.'
    );
  });
});

describe('secrets', () => {
  test('a secret goes to the secret store, and declining sends no value', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['gates', 'secret', 'gate-secret', 's3cret'])).text).toBe(
      'Saved. The agent gets a reference, never the value.'
    );
    expect((await runSpec(fake, ['gates', 'decline-secret', 'gate-secret'])).text).toBe('Declined.');
    expect(fake.posts).toEqual([
      { path: '/api/secrets/gate-secret', body: { value: 's3cret' } },
      { path: '/api/secrets/gate-secret', body: { decline: true } },
    ]);
    expect(fake.sent).toEqual([]);
  });
});
