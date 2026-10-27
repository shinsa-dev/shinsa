import { describe, expect, test } from 'bun:test';
import { GATE_SPECS } from '../../src/surface/gates.ts';
import { listAgentSpecs } from '../../src/surface/index.ts';
import { createFakeClient, createTaskDetail, runSpec } from './fixtures.ts';

function gate(id: string, type: string, extra: Record<string, unknown> = {}) {
  return { id, taskId: 'task-123', type, status: 'open', title: id, ...extra };
}

const OPEN = createTaskDetail({
  gates: [
    gate('gate-plan', 'plan', { planVersion: 2 }),
    gate('gate-review', 'review'),
    gate('gate-merge', 'merge'),
    gate('gate-secret', 'secret', { secret: { name: 'TOKEN' } }),
    gate('gate-question', 'question'),
    gate('gate-operation', 'operation'),
  ],
});

const NONE = createTaskDetail({ gates: [gate('gate-other', 'failure')] });

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
    expect(result.text).toBe('Asked for changes. The agent picks them up.');
  });

  test('waive starts a task without checks at its setup gate', async () => {
    const fake = createClient();
    expect((await runSpec(fake, ['gates', 'answer', 'gate-setup', '--decision', 'waive'])).text).toBe(
      'Starting without checks.'
    );
    expect(fake.sent).toEqual([
      { type: 'gate.answer', gateId: 'gate-setup', decision: 'waive', response: null },
    ]);
  });

  test('an answer to a question or a failure is a reply', async () => {
    const fake = createClient();
    expect(
      (await runSpec(fake, ['gates', 'answer', 'gate-question', '--decision', 'reply', '--response', 'Blue']))
        .text
    ).toBe('Answered. The agent carries on.');
    expect(fake.sent).toEqual([
      { type: 'gate.answer', gateId: 'gate-question', decision: 'reply', response: 'Blue' },
    ]);
    expect(() => runSpec(fake, ['gates', 'answer', 'gate-question', '--decision', 'answer'])).toThrow(
      '--decision must be one of approve, revise, reject, reply, waive.'
    );
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
      'Asked for changes. The agent picks them up.',
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
      'Asked for changes. The agent picks them up.',
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
      { gateId: 'gate-operation', decision: 'reply', response: 'staging first' },
      'Running the operation with your notes.',
    ],
    [
      ['operations', 'finish', 'fix'],
      { gateId: 'gate-operation', decision: 'reject', response: null },
      'Finished without running the operation.',
    ],
    [
      ['questions', 'answer', 'fix', 'blue'],
      { gateId: 'gate-question', decision: 'reply', response: 'blue' },
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

describe('who decides at a gate', () => {
  test('every gate command is yours alone: answering an agent’s question included, no agent has a tool for one', () => {
    expect(GATE_SPECS.filter((spec) => !spec.humanOnly).map((spec) => spec.path.join(' '))).toEqual([]);
    const agentPaths = listAgentSpecs().map((spec) => spec.path.join(' '));
    expect(agentPaths).not.toContain('questions answer');
    expect(agentPaths.some((path) => GATE_SPECS.some((spec) => spec.path.join(' ') === path))).toBe(false);
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

describe('ticking a step around the merge', () => {
  const STEPS = [
    {
      key: 'pre_merge:Set A',
      when: 'pre_merge',
      kind: 'env',
      title: 'Set A',
      detail: 'd',
      command: null,
      done: false,
    },
    {
      key: 'post_merge:Migrate',
      when: 'post_merge',
      kind: 'migration',
      title: 'Migrate',
      detail: 'd',
      command: 'm',
      done: false,
    },
  ];

  function stepsClient(steps: unknown[] = STEPS) {
    return createFakeClient({ '/api/tasks/fix': createTaskDetail({ mergeSteps: steps }) });
  }

  test('ticks a step by its number or its title, and unticks it with --undo', async () => {
    const fake = stepsClient();
    expect((await runSpec(fake, ['merges', 'tick', 'fix', '2'])).text).toBe('Ticked the step.');
    expect((await runSpec(fake, ['merges', 'tick', 'fix', 'set', 'a', '--undo'])).text).toBe(
      'Unticked the step.'
    );
    await runSpec(fake, ['merges', 'tick', 'fix', 'pre_merge:Set A']);
    expect(fake.sent).toEqual([
      { type: 'merge_step.tick', taskId: 'task-123', key: 'post_merge:Migrate', done: true },
      { type: 'merge_step.tick', taskId: 'task-123', key: 'pre_merge:Set A', done: false },
      { type: 'merge_step.tick', taskId: 'task-123', key: 'pre_merge:Set A', done: true },
    ]);
  });

  test('names a step it cannot find, or a task with none', async () => {
    await expect(runSpec(stepsClient(), ['merges', 'tick', 'fix', 'Deploy'])).rejects.toThrow(
      '“Fix the tab scroll” has no step Deploy. `shinsa tasks show` lists its steps, numbered from 1.'
    );
    await expect(runSpec(stepsClient([]), ['merges', 'tick', 'fix', '1'])).rejects.toThrow(
      '“Fix the tab scroll” has no steps around the merge.'
    );
  });

  test('is the human’s alone', () => {
    expect(listAgentSpecs().some((spec) => spec.path.join(' ') === 'merges tick')).toBe(false);
  });
});
