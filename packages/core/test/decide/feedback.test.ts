import { describe, expect, test } from 'bun:test';
import { FEEDBACK_LIMITS, listFeedback } from '../../src/index.ts';
import { buildAll, createHarness, createTask, type Harness, PASSING } from '../harness.ts';

function write(harness: Harness, note: string, feedbackId: string | null = null) {
  return harness.send({ type: 'feedback.write', feedbackId, note });
}

function only(harness: Harness) {
  const [entry] = listFeedback(harness.state);
  if (!entry) throw new Error('no feedback');
  return entry;
}

function drafted(harness: Harness, title = 'Plan tool refuses a valid phase', body = 'Steps to reproduce.') {
  write(harness, 'The plan tool refused my phase.');
  const entry = only(harness);
  harness.send({ type: 'feedback.record_draft', feedbackId: entry.id, title, body });
  return only(harness);
}

function report(harness: Harness, taskId: string, note: string) {
  return harness.send({ type: 'agent.report_feedback', runId: harness.activeRun(taskId).id, note });
}

describe('writing feedback', () => {
  test('a note is drafted by your agent, then waits for you as an issue', () => {
    const harness = createHarness();
    write(harness, '  The plan tool refused my phase.  ');
    const entry = only(harness);
    expect(entry).toMatchObject({
      source: 'human',
      note: 'The plan tool refused my phase.',
      status: 'drafting',
      title: null,
      taskId: null,
    });
    expect(harness.lastEffect('feedback.draft')).toEqual({ kind: 'feedback.draft', feedbackId: entry.id });
    harness.send({
      type: 'feedback.record_draft',
      feedbackId: entry.id,
      title: ' Plan refused ',
      body: ' Steps. ',
    });
    expect(only(harness)).toMatchObject({ status: 'draft', title: 'Plan refused', body: 'Steps.' });
  });

  test('an empty note or one over the limit is refused', () => {
    const harness = createHarness();
    expect(() => write(harness, '  ')).toThrow('Write what you want to tell Shinsa.');
    expect(() => write(harness, 'x'.repeat(FEEDBACK_LIMITS.note + 1))).toThrow(
      `Feedback can be at most ${FEEDBACK_LIMITS.note} characters.`
    );
  });

  test('a long draft is cut to the limits, and an empty one fails', () => {
    const harness = createHarness();
    write(harness, 'A note.');
    const entry = only(harness);
    harness.send({
      type: 'feedback.record_draft',
      feedbackId: entry.id,
      title: 't'.repeat(FEEDBACK_LIMITS.title + 5),
      body: 'b'.repeat(FEEDBACK_LIMITS.body + 5),
    });
    expect(only(harness).title).toHaveLength(FEEDBACK_LIMITS.title);
    expect(only(harness).body).toHaveLength(FEEDBACK_LIMITS.body);
    write(harness, 'Another note.', entry.id);
    harness.send({ type: 'feedback.record_draft', feedbackId: entry.id, title: ' ', body: 'Body.' });
    expect(only(harness)).toMatchObject({
      status: 'failed',
      failure: 'The draft came back empty.',
      title: null,
    });
  });

  test('a draft that arrives late, or for feedback that is gone, changes nothing', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    const late = {
      type: 'feedback.record_draft',
      feedbackId: entry.id,
      title: 'Other',
      body: 'Other.',
    } as const;
    expect(harness.send(late).events).toEqual([]);
    expect(harness.send({ ...late, feedbackId: 'missing' }).events).toEqual([]);
  });

  test('rewriting a note drafts it again, but not while it is drafted, opened or open', () => {
    const harness = createHarness();
    write(harness, 'First note.');
    const entry = only(harness);
    expect(() => write(harness, 'Second note.', entry.id)).toThrow('Your agent is still writing this issue.');
    harness.send({
      type: 'feedback.record_failure',
      feedbackId: entry.id,
      detail: 'The model did not answer.',
    });
    expect(only(harness)).toMatchObject({ status: 'failed', failure: 'The model did not answer.' });
    write(harness, 'Second note.', entry.id);
    expect(only(harness)).toMatchObject({ status: 'drafting', note: 'Second note.', failure: null });
    expect(harness.effectsOf('feedback.draft')).toHaveLength(2);
    harness.send({ type: 'feedback.record_draft', feedbackId: entry.id, title: 'Title', body: 'Body.' });
    harness.send({ type: 'feedback.file', feedbackId: entry.id });
    expect(() => write(harness, 'Third note.', entry.id)).toThrow('This issue is being opened on GitHub.');
    harness.send({
      type: 'feedback.record_filed',
      feedbackId: entry.id,
      number: 12,
      url: 'https://github.com/x/12',
    });
    expect(() => write(harness, 'Third note.', entry.id)).toThrow('This issue is already open on GitHub.');
    expect(() => write(harness, 'A note.', 'missing')).toThrow('No feedback missing');
  });
});

describe('changing a draft', () => {
  test('your edits replace the title and the body, and the same edit twice changes nothing', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    harness.send({
      type: 'feedback.update',
      feedbackId: entry.id,
      title: ' New title ',
      body: ' New body. ',
    });
    expect(only(harness)).toMatchObject({ title: 'New title', body: 'New body.', status: 'draft' });
    expect(
      harness.send({ type: 'feedback.update', feedbackId: entry.id, title: 'New title', body: 'New body.' })
        .events
    ).toEqual([]);
  });

  test('an edit after a failed filing makes it a draft again', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    harness.send({ type: 'feedback.file', feedbackId: entry.id });
    harness.send({ type: 'feedback.record_failure', feedbackId: entry.id, detail: 'gh is not signed in.' });
    harness.send({
      type: 'feedback.update',
      feedbackId: entry.id,
      title: entry.title ?? '',
      body: entry.body ?? '',
    });
    expect(only(harness)).toMatchObject({ status: 'draft', failure: null });
  });

  test('a draft needs a title and a body within their limits, and only a waiting draft changes', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    const update = { type: 'feedback.update', feedbackId: entry.id, title: 'Title', body: 'Body.' } as const;
    expect(() => harness.send({ ...update, title: ' ' })).toThrow(
      'The issue needs a title and a description.'
    );
    expect(() => harness.send({ ...update, body: 'x'.repeat(FEEDBACK_LIMITS.body + 1) })).toThrow(
      `A title can be at most ${FEEDBACK_LIMITS.title} characters`
    );
    write(harness, 'Another note.', entry.id);
    expect(() => harness.send(update)).toThrow('Only a draft that waits for you can be changed.');
  });
});

describe('opening an issue', () => {
  test('you open a clean draft, and Shinsa records the issue', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    harness.send({ type: 'feedback.file', feedbackId: entry.id });
    expect(only(harness).status).toBe('filing');
    expect(harness.lastEffect('feedback.file')).toEqual({ kind: 'feedback.file', feedbackId: entry.id });
    const url = 'https://github.com/shinsa-dev/shinsa/issues/12';
    harness.send({ type: 'feedback.record_filed', feedbackId: entry.id, number: 12, url });
    expect(only(harness)).toMatchObject({ status: 'filed', issue: { number: 12, url } });
    expect(
      harness.send({ type: 'feedback.record_filed', feedbackId: entry.id, number: 13, url }).events
    ).toEqual([]);
    expect(
      harness.send({ type: 'feedback.record_failure', feedbackId: entry.id, detail: 'x' }).events
    ).toEqual([]);
    expect(
      harness.send({ type: 'feedback.record_failure', feedbackId: 'missing', detail: 'x' }).events
    ).toEqual([]);
  });

  test('a draft with a private detail is refused and says what it found', () => {
    const harness = createHarness();
    createTask(harness);
    const entry = drafted(harness, 'Superwall plans fail', 'Mail jane@acme.io about /Users/jane/app.');
    expect(() => harness.send({ type: 'feedback.file', feedbackId: entry.id })).toThrow(
      'This issue still has a name from your projects (“Superwall”), an email address (“jane@acme.io”), a folder path (“/Users/jane/app.”). Take it out before you open the issue.'
    );
    expect(only(harness).status).toBe('draft');
  });

  test('names every kind of leak it refuses', () => {
    const harness = createHarness();
    const entry = drafted(harness, 'A token', 'ghp_abcdefghijklmnopqrstuvwxyz12 from https://example.com/x');
    expect(() => harness.send({ type: 'feedback.file', feedbackId: entry.id })).toThrow(
      'what looks like a token or a key (“ghp_abcdefghijklmnopqrstuvwxyz12”), a link outside Shinsa (“https://example.com/x”)'
    );
  });

  test('only you open an issue: one sent on your behalf is refused', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    expect(() => harness.send({ type: 'feedback.file', feedbackId: entry.id }, { onBehalf: true })).toThrow(
      'Only the human opens a public issue.'
    );
  });

  test('only a waiting draft opens', () => {
    const harness = createHarness();
    write(harness, 'A note.');
    expect(() => harness.send({ type: 'feedback.file', feedbackId: only(harness).id })).toThrow(
      'Only a draft that waits for you can be opened as an issue.'
    );
  });
});

describe('dismissing feedback', () => {
  test('removes it, except while the issue is being opened', () => {
    const harness = createHarness();
    const entry = drafted(harness);
    harness.send({ type: 'feedback.file', feedbackId: entry.id });
    expect(() => harness.send({ type: 'feedback.dismiss', feedbackId: entry.id })).toThrow(
      'This issue is being opened on GitHub.'
    );
    harness.send({ type: 'feedback.record_failure', feedbackId: entry.id, detail: 'Offline.' });
    harness.send({ type: 'feedback.dismiss', feedbackId: entry.id });
    expect(listFeedback(harness.state)).toEqual([]);
  });

  test('on your behalf it is recorded as such', () => {
    const harness = createHarness();
    write(harness, 'A note.', null);
    const entry = only(harness);
    harness.send({ type: 'feedback.record_failure', feedbackId: entry.id, detail: 'Offline.' });
    harness.send({ type: 'feedback.write', feedbackId: entry.id, note: 'Again.' }, { onBehalf: true });
    harness.send({ type: 'feedback.record_draft', feedbackId: entry.id, title: 'T', body: 'B.' });
    harness.send(
      { type: 'feedback.update', feedbackId: entry.id, title: 'T2', body: 'B2.' },
      { onBehalf: true }
    );
    harness.send({ type: 'feedback.dismiss', feedbackId: entry.id }, { onBehalf: true });
    harness.send({ type: 'feedback.write', feedbackId: null, note: 'New.' }, { onBehalf: true });
    expect(harness.state.onBehalfActions.map((action) => action.summary)).toEqual([
      'Rewrote a note of feedback on Shinsa',
      'Changed a feedback issue that waits for you',
      'Dismissed feedback on Shinsa',
      'Wrote feedback on Shinsa',
    ]);
  });
});

describe('an agent reports feedback', () => {
  test('its report is drafted like yours, marked as an agent’s, and shows in its task', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const run = harness.activeRun(taskId);
    report(harness, taskId, ' The checks tool ran the wrong folder. ');
    expect(only(harness)).toMatchObject({
      source: 'agent',
      note: 'The checks tool ran the wrong folder.',
      status: 'drafting',
      taskId,
      runId: run.id,
    });
    expect(harness.lastEffect('feedback.draft').feedbackId).toBe(only(harness).id);
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({
      actor: 'agent',
      kind: 'suggestion',
      text: 'Reported feedback on Shinsa',
      detail: 'The checks tool ran the wrong folder.',
      runId: run.id,
    });
  });

  test('the same report twice is taken once, whatever its case', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    report(harness, taskId, 'The checks tool ran the wrong folder.');
    expect(report(harness, taskId, 'the CHECKS tool ran the wrong folder.').events).toEqual([]);
    expect(listFeedback(harness.state)).toHaveLength(1);
  });

  test('a task reports at most three things', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    for (let index = 0; index < FEEDBACK_LIMITS.perTask; index += 1)
      report(harness, taskId, `Report ${index}.`);
    expect(() => report(harness, taskId, 'One more.')).toThrow(
      'This task already reported 3 things about Shinsa.'
    );
  });

  test('at most ten agent reports wait for you at once', () => {
    const harness = createHarness();
    for (let index = 0; index < FEEDBACK_LIMITS.agentWaiting; index += 1) {
      report(harness, createTask(harness), `Report ${index}.`);
    }
    expect(() => report(harness, createTask(harness), 'One more.')).toThrow(
      'The human already has 10 reports to read.'
    );
  });

  test('feedback an agent writes for you is an agent’s, with its task and the same limits', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const send = (note: string) =>
      harness.send({ type: 'feedback.write', feedbackId: null, note }, { onBehalf: true, byTask: taskId });
    send('The plan tool refused my phase.');
    expect(only(harness)).toMatchObject({ source: 'agent', taskId, runId: null });
    send('the plan tool refused my phase.');
    expect(listFeedback(harness.state)).toHaveLength(1);
    report(harness, taskId, 'Report 1.');
    report(harness, taskId, 'Report 2.');
    expect(() => send('One more.')).toThrow('This task already reported 3 things about Shinsa.');
  });

  test('feedback written for you outside a task still counts as an agent’s', () => {
    const harness = createHarness();
    for (let index = 0; index < FEEDBACK_LIMITS.agentWaiting; index += 1) {
      report(harness, createTask(harness), `Report ${index}.`);
    }
    expect(() =>
      harness.send({ type: 'feedback.write', feedbackId: null, note: 'One more.' }, { onBehalf: true })
    ).toThrow('The human already has 10 reports to read.');
  });

  test('an empty report is refused', () => {
    const harness = createHarness();
    expect(() => report(harness, createTask(harness), ' ')).toThrow('Write what you want to tell Shinsa.');
  });

  test('the reviewer reports too', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.activeRun(taskId).role).toBe('reviewer');
    report(harness, taskId, 'The review tool cut my finding.');
    expect(only(harness).source).toBe('agent');
  });
});
