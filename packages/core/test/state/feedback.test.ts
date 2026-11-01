import { describe, expect, test } from 'bun:test';
import {
  type Feedback,
  listFeedback,
  listFeedbackEntryLeaks,
  listPrivateWords,
  resolveFeedbackIssueText,
} from '../../src/index.ts';
import { createHarness, createTask, registerRepo } from '../harness.ts';

function entry(id: string, createdAt: number): Feedback {
  return {
    id,
    source: 'human',
    note: 'A note.',
    title: 'A title',
    body: 'A body.',
    status: 'draft',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

describe('listPrivateWords', () => {
  test('names the projects, repositories, folders, branches, handles and accounts Shinsa knows', () => {
    const harness = createHarness();
    harness.send({
      type: 'repo.register',
      repo: {
        name: 'app',
        path: '/Users/jane/code/app',
        defaultBranch: 'main',
        remote: 'git@github.com:acme/app.git',
        checkCommands: [],
      },
      projectName: 'Acme',
    });
    const taskId = createTask(harness);
    const task = harness.task(taskId);
    harness.send({ type: 'task.bind_account', taskId, account: { id: 'a1', email: 'jane@acme.io' } });
    const words = listPrivateWords(harness.state);
    expect(words).toEqual(
      expect.arrayContaining([
        'Acme',
        'app',
        '/Users/jane/code/app',
        'jane',
        'acme',
        'acme/app',
        task.handle ?? '',
        task.branch ?? '',
        'jane@acme.io',
      ])
    );
    expect(new Set(words).size).toBe(words.length);
  });

  test('reads the account of a run and a home folder on Linux', () => {
    const harness = createHarness();
    harness.send({
      type: 'repo.register',
      repo: { name: 'api', path: '/home/sam/api', defaultBranch: 'main', remote: null, checkCommands: [] },
      projectName: null,
    });
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'run.attempt',
      runId,
      attemptId: 'attempt-1',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      account: { id: 'a2', email: 'sam@example.org' },
    });
    expect(listPrivateWords(harness.state)).toEqual(expect.arrayContaining(['sam', 'sam@example.org']));
  });
});

describe('feedback in state', () => {
  test('lists the newest first', () => {
    const harness = createHarness();
    harness.replay({ type: 'feedback.recorded', entry: entry('b', 1) });
    harness.replay({ type: 'feedback.recorded', entry: entry('a', 1) });
    harness.replay({ type: 'feedback.recorded', entry: entry('c', 5) });
    expect(listFeedback(harness.state).map((item) => item.id)).toEqual(['c', 'a', 'b']);
    harness.replay({ type: 'feedback.removed', feedbackId: 'a' });
    expect(listFeedback(harness.state).map((item) => item.id)).toEqual(['c', 'b']);
  });

  test('checks the title and the body of an issue against what Shinsa knows', () => {
    const harness = createHarness();
    registerRepo(harness, 'paywall-next', 'Superwall');
    expect(resolveFeedbackIssueText({ title: null, body: null })).toBe('\n\n');
    expect(
      listFeedbackEntryLeaks(harness.state, { title: 'Superwall is slow', body: 'In paywall-next.' })
    ).toEqual([
      { kind: 'private_word', text: 'Superwall' },
      { kind: 'private_word', text: 'paywall-next' },
    ]);
  });
});
