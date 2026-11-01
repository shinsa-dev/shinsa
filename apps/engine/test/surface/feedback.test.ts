import { describe, expect, test } from 'bun:test';
import { createFakeClient, findSpec, runSpec } from './fixtures.ts';

const ENTRY = {
  note: 'n',
  failure: null,
  issue: null,
  task: null,
  taskId: null,
  runId: null,
  leaks: [],
  createdAt: 1,
  updatedAt: 1,
};

describe('shinsa feedback', () => {
  test('lists feedback with its status, where it came from, its link, failure and what is still private', async () => {
    const fake = createFakeClient({
      '/api/feedback': {
        feedback: [
          {
            ...ENTRY,
            id: 'f1',
            source: 'human',
            status: 'drafting',
            note: 'The plan tab hides changes.',
            title: null,
            body: null,
          },
          {
            ...ENTRY,
            id: 'f2',
            source: 'agent',
            status: 'draft',
            task: 'LOC-12',
            title: 'Spots refuse deleted files',
            body: 'b',
            leaks: [{ kind: 'private_word', text: 'Paywalls' }],
          },
          {
            ...ENTRY,
            id: 'f3',
            source: 'agent',
            status: 'failed',
            title: 'T',
            body: 'b',
            failure: 'gh issue create failed: HTTP 401',
          },
          {
            ...ENTRY,
            id: 'f4',
            source: 'human',
            status: 'filed',
            title: 'Filed one',
            body: 'b',
            issue: { number: 4, url: 'https://github.com/shinsa-dev/shinsa/issues/4' },
          },
          { ...ENTRY, id: 'f5', source: 'human', status: 'filing', title: 'Opening', body: 'b' },
        ],
      },
    });
    expect((await runSpec(fake, ['feedback', 'list'])).text.split('\n')).toEqual([
      'f1  (drafting, from you) The plan tab hides changes.',
      'f2  (waits for you, from an agent in LOC-12) Spots refuse deleted files',
      '  Still private: Paywalls',
      'f3  (failed, from an agent) T',
      '  gh issue create failed: HTTP 401',
      'f4  (open, from you) Filed one',
      '  https://github.com/shinsa-dev/shinsa/issues/4',
      'f5  (opening, from you) Opening',
    ]);
    const empty = createFakeClient({ '/api/feedback': { feedback: [] } });
    expect((await runSpec(empty, ['feedback', 'list'])).text).toBe('No feedback yet.');
  });

  test('writes, rewrites, edits, opens and dismisses feedback, and only the human opens an issue', async () => {
    const fake = createFakeClient();
    expect((await runSpec(fake, ['feedback', 'write', 'The', 'plan', 'tab.'])).text).toContain(
      'Your agent is drafting the issue.'
    );
    await runSpec(fake, ['feedback', 'write', '--id', 'f1', 'Again.']);
    await runSpec(fake, ['feedback', 'edit', 'f1', '--title', 'Title', '--body', 'Body.']);
    await runSpec(fake, ['feedback', 'file', 'f1']);
    await runSpec(fake, ['feedback', 'dismiss', 'f2']);
    expect(fake.sent).toEqual([
      { type: 'feedback.write', feedbackId: null, note: 'The plan tab.' },
      { type: 'feedback.write', feedbackId: 'f1', note: 'Again.' },
      { type: 'feedback.update', feedbackId: 'f1', title: 'Title', body: 'Body.' },
      { type: 'feedback.file', feedbackId: 'f1' },
      { type: 'feedback.dismiss', feedbackId: 'f2' },
    ]);
    expect(findSpec(['feedback', 'file']).humanOnly).toBe(true);
    for (const action of ['list', 'write', 'edit', 'dismiss'])
      expect(findSpec(['feedback', action]).humanOnly).toBeUndefined();
  });
});
