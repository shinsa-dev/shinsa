import { describe, expect, test } from 'bun:test';
import {
  type Feedback,
  isFeedbackFileable,
  isFeedbackWaiting,
  isPrivateWord,
  listFeedbackLeaks,
  resolveFeedbackText,
} from '../../src/index.ts';

function entry(patch: Partial<Feedback>): Feedback {
  return {
    id: 'f1',
    source: 'human',
    note: 'The plan tool refused a phase.',
    title: 'Plan tool refuses a valid phase',
    body: 'Steps to reproduce.',
    status: 'draft',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

describe('listFeedbackLeaks', () => {
  test('finds nothing in a generic report', () => {
    expect(
      listFeedbackLeaks(
        'Shinsa refused a plan with two phases. See https://github.com/shinsa-dev/shinsa/issues/4 and ~/.config/shinsa.',
        ['Superwall']
      )
    ).toEqual([]);
  });

  test('finds emails, home folders and keys, each once, in the order they appear', () => {
    const text = [
      'Mail me at jane.doe@acme.io or jane.doe@acme.io.',
      'It failed in /Users/jane/code/app/src/a.ts and C:\\Users\\jane\\app.',
      'My key sk-ant-api03-abcdefghijklmnop and ghp_abcdefghijklmnopqrstuvwxyz12.',
    ].join('\n');
    expect(listFeedbackLeaks(text, [])).toEqual([
      { kind: 'email', text: 'jane.doe@acme.io' },
      { kind: 'path', text: '/Users/jane/code/app/src/a.ts' },
      { kind: 'path', text: 'C:\\Users\\jane\\app.' },
      { kind: 'secret', text: 'sk-ant-api03-abcdefghijklmnop' },
      { kind: 'secret', text: 'ghp_abcdefghijklmnopqrstuvwxyz12' },
    ]);
  });

  test('finds every kind of token and key it knows', () => {
    const tokens = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'github_pat_11ABCDEFGHIJKLMNOPQRST',
      'xoxb-1234567890-abcdef',
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4',
      'password=hunter2',
      'Token: abc123',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    ];
    for (const token of tokens) {
      expect(listFeedbackLeaks(`Look: ${token}`, []).map((leak) => leak.kind)).toContain('secret');
    }
  });

  test('a long word without digits is no key', () => {
    expect(listFeedbackLeaks('the-settings-page-forgets-the-chosen-layout-after-reload', [])).toEqual([]);
  });

  test('finds links outside Shinsa, and allows Shinsa’s own and local ones', () => {
    expect(
      listFeedbackLeaks(
        'See https://linear.app/acme/issue/1, https://shinsa.dev/download, http://localhost:5180/tasks and https://github.com/shinsa-dev/shinsa.',
        []
      )
    ).toEqual([{ kind: 'url', text: 'https://linear.app/acme/issue/1' }]);
    expect(listFeedbackLeaks('https://github.com/shinsa-dev/shinsa-private', [])).toEqual([
      { kind: 'url', text: 'https://github.com/shinsa-dev/shinsa-private' },
    ]);
  });

  test('finds private words as whole words, whatever their case', () => {
    expect(
      listFeedbackLeaks('Superwall broke in SW-142 on feat/paywalls, not in superwallet.', [
        'Superwall',
        'SW',
        'feat/paywalls',
        'SW-142',
        'x',
        'Shinsa',
      ])
    ).toEqual([
      { kind: 'private_word', text: 'Superwall' },
      { kind: 'private_word', text: 'SW-142' },
      { kind: 'private_word', text: 'feat/paywalls' },
    ]);
  });

  test('matches a short key only in capitals, so it never blocks an ordinary word', () => {
    expect(listFeedbackLeaks('One menu per task, then PER and app.', ['PER', 'App'])).toEqual([
      { kind: 'private_word', text: 'PER' },
      { kind: 'private_word', text: 'app' },
    ]);
  });

  test('takes regex characters in a word literally', () => {
    expect(listFeedbackLeaks('The a.b project and aXb', ['a.b'])).toEqual([
      { kind: 'private_word', text: 'a.b' },
    ]);
  });
});

describe('isPrivateWord', () => {
  test('a public name or a single character is not private', () => {
    expect(isPrivateWord('Shinsa')).toBe(false);
    expect(isPrivateWord('shinsa-dev')).toBe(false);
    expect(isPrivateWord(' a ')).toBe(false);
    expect(isPrivateWord('SW')).toBe(true);
  });
});

describe('a feedback entry', () => {
  test('waits for you as a draft or after a failure, and can be opened once it has a title and body', () => {
    expect(isFeedbackWaiting(entry({ status: 'draft' }))).toBe(true);
    expect(isFeedbackWaiting(entry({ status: 'failed' }))).toBe(true);
    expect(isFeedbackWaiting(entry({ status: 'drafting' }))).toBe(false);
    expect(isFeedbackFileable(entry({ status: 'failed' }))).toBe(true);
    expect(isFeedbackFileable(entry({ status: 'failed', title: null, body: null }))).toBe(false);
    expect(isFeedbackFileable(entry({ status: 'filed' }))).toBe(false);
  });

  test('text is trimmed', () => {
    expect(resolveFeedbackText('  a note \n')).toBe('a note');
  });
});
