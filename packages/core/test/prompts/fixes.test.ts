import { describe, expect, test } from 'bun:test';
import {
  resolveChecksFixPrompt,
  resolveConflictFixPrompt,
  resolveFixFocus,
  resolveHumanFixPrompt,
  resolvePullRequestFixPrompt,
  resolveReviewFixPrompt,
  resolveVerdictFixPrompt,
  resolveWorkspaceUpdatedFixPrompt,
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
  test('each fix prompt opens with the words its run’s focus is read from', () => {
    const focusOf = (prompt: string) => resolveFixFocus({ purpose: 'fix', prompt });
    expect(focusOf(resolveChecksFixPrompt([{ name: 'test', outcome: 'fail', detail: '' }]))).toBe('checks');
    expect(focusOf(resolveReviewFixPrompt([finding]))).toBe('review');
    expect(focusOf(resolveHumanFixPrompt('Rename it.', []))).toBe('changes');
    expect(focusOf(resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null, []))).toBe('changes');
    expect(focusOf(resolvePullRequestFixPrompt(pullRequest({ number: 42 })))).toBe('pull_request');
    expect(focusOf(resolveConflictFixPrompt('feat/banner'))).toBe('conflicts');
  });

  test('a fix of the work says the checks and the review follow it', () => {
    expect(resolveHumanFixPrompt('Rename it.', [])).toContain(
      "Afterwards Shinsa runs the task's checks and agent review, where it has them, and then the human reviews the work."
    );
  });

  test('every fix prompt says when to send the parts of the walkthrough that changed', () => {
    for (const prompt of [
      resolveChecksFixPrompt([{ name: 'test', outcome: 'fail', detail: '' }]),
      resolveReviewFixPrompt([finding]),
      resolvePullRequestFixPrompt(pullRequest({ number: 42 })),
    ]) {
      expect(prompt).toContain(
        'When the fix changes the approach, the flow, a risk, how to test it or the steps the human takes around the merge, also send `walkthrough` with only the parts that changed. Otherwise leave it out.'
      );
    }
  });

  test('a pull request fix says Shinsa pushes it, not that the checks and review run again', () => {
    const prompt = resolvePullRequestFixPrompt(pullRequest({ checks: 'failing' }));
    expect(prompt).toContain('Afterwards Shinsa pushes your fix to the pull request.');
    expect(prompt).not.toContain('agent review');
  });

  test('a conflict is merged from the fetched base by name and never rebased', () => {
    const conflicting = pullRequest({ mergeable: false, base: 'main' });
    expect(resolvePullRequestFixPrompt(conflicting)).toContain(
      '- The branch has merge conflicts with its base, `main`. Shinsa fetched it: merge it in with `git merge origin/main`, resolve every conflict and `git add` the files. Leave the merge uncommitted: Shinsa commits it with your fix. Never rebase or force-push.'
    );
    expect(resolvePullRequestFixPrompt({ ...conflicting, base: undefined })).toContain(
      'Fetch the base branch, merge it in with `git merge`'
    );
  });

  test('after the workspace update the agent resolves what is left in place, with the human’s guidance', () => {
    const prompt = resolveWorkspaceUpdatedFixPrompt('fix/a', ' Keep their version. ');
    expect(prompt).toContain('Shinsa updated their GitButler workspace with `but pull`');
    expect(prompt).toContain('`but resolve conflicts fix/a`');
    expect(prompt).toContain('Never run `but resolve <commit>`');
    expect(prompt).toContain('Guidance from the human: Keep their version.');
    expect(prompt).toContain('Afterwards Shinsa pushes the branch to the pull request.');
    expect(resolveWorkspaceUpdatedFixPrompt('fix/a', null)).not.toContain('Guidance');
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
    const prompt = resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null, []);
    expect(prompt).toContain('Fix these:\n- [blocking] Handle the timeout.');
    expect(prompt).not.toContain('Leave these alone');
    expect(prompt).not.toContain('The human also wrote');
  });
});

describe('line comments in a fix prompt', () => {
  const rename = {
    path: 'src/a.ts',
    side: 'new' as const,
    line: 12,
    endLine: 13,
    text: 'Name it for what it holds.',
  };

  test('a comment carries its path, lines and words', () => {
    const prompt = resolveHumanFixPrompt('Tidy the names.', [rename]);
    expect(prompt).toContain('The human looked at the work and wrote:\n\nTidy the names.\n\nLine comments:');
    expect(prompt).toContain('- src/a.ts, lines 12-13: Name it for what it holds.');
  });

  test('comments alone open the prompt without words of their own', () => {
    const prompt = resolveHumanFixPrompt(' ', [
      { path: 'src/b.ts', side: 'old', line: 4, endLine: null, text: 'Keep this line.' },
    ]);
    expect(prompt).toStartWith('The human looked at the work and left line comments.\n\nLine comments:\n');
    expect(prompt).toContain('- src/b.ts, removed line 4: Keep this line.');
  });

  test('with neither words nor comments, the agent is asked to revise the work', () => {
    expect(resolveHumanFixPrompt(null, [])).toContain('wrote:\n\nRevise the work.');
  });

  test('a verdict prompt lists the line comments after your words', () => {
    const prompt = resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], 'Also this.', [rename]);
    expect(prompt).toContain('The human also wrote:\nAlso this.\n\nLine comments:\n- src/a.ts, lines 12-13');
  });
});
