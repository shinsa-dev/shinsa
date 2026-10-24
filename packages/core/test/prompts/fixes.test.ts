import { describe, expect, test } from 'bun:test';
import {
  resolveChecksFixPrompt,
  resolveHumanFixPrompt,
  resolvePullRequestFixPrompt,
  resolveReviewFixPrompt,
  resolveVerdictFixPrompt,
} from '../../src/prompts/index.ts';
import { pullRequest } from '../harness.ts';

const finding = { severity: 'blocking' as const, file: null, line: null, message: 'Handle the timeout.' };

const remark = {
  id: 'remark-1',
  author: 'ana',
  createdAt: '2026-01-01T00:00:00Z',
  editedAt: null,
  body: 'Typo',
  path: null,
  url: null,
  reviewState: null,
};

describe('fix prompts', () => {
  test('each fix prompt opens with the words the web labels its run by', () => {
    expect(resolveChecksFixPrompt([{ name: 'test', outcome: 'fail', detail: '' }])).toStartWith(
      'The checks failed'
    );
    expect(resolveReviewFixPrompt([finding])).toStartWith('The agent review found');
    expect(resolveHumanFixPrompt('Rename it.')).toStartWith('The human looked at the work');
    expect(resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null)).toStartWith(
      'The human looked at the work'
    );
    expect(resolvePullRequestFixPrompt(pullRequest({ number: 42 }))).toStartWith('Pull request #42');
  });

  test('a fix of the work says the checks and the review follow it', () => {
    expect(resolveHumanFixPrompt('Rename it.')).toContain(
      "Afterwards Shinsa runs the task's checks and agent review, where it has them, and then the human reviews the work."
    );
  });

  test('a pull request fix says Shinsa pushes it, not that the checks and review run again', () => {
    const prompt = resolvePullRequestFixPrompt(pullRequest({ checks: 'failing' }));
    expect(prompt).toContain('Afterwards Shinsa pushes your fix to the pull request.');
    expect(prompt).not.toContain('agent review');
  });

  test('one unresolved comment and one new comment read in the singular', () => {
    const prompt = resolvePullRequestFixPrompt(pullRequest({ unresolvedComments: 1 }), [
      { kind: 'remarks', remarks: [remark] },
    ]);
    expect(prompt).toContain('There is 1 unresolved review comment (review bots or people)');
    expect(prompt).toContain('- 1 new comment:');
  });
});

describe('resolveVerdictFixPrompt', () => {
  test('with only fixes, lists them and nothing it does not need', () => {
    const prompt = resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null);
    expect(prompt).toContain('Fix these:\n- [blocking] Handle the timeout.');
    expect(prompt).not.toContain('Leave these alone');
    expect(prompt).not.toContain('The human also wrote');
  });
});
