import { describe, expect, test } from 'bun:test';
import {
  resolveChecksFixPrompt,
  resolveFixFocus,
  resolveHumanFixPrompt,
  resolvePullRequestFixPrompt,
  resolvePushHookFixPrompt,
  resolveReviewFixPrompt,
  resolveUpdateConflictFixPrompt,
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
  test('each fix prompt opens with the words its run’s focus is read from', () => {
    const focusOf = (prompt: string) => resolveFixFocus({ purpose: 'fix', prompt });
    expect(
      focusOf(
        resolveChecksFixPrompt(
          [{ id: 'c1', label: 'Tests', command: 'bun test src/a', outcome: 'fail', detail: '' }],
          false
        )
      )
    ).toBe('checks');
    expect(focusOf(resolveReviewFixPrompt([finding]))).toBe('review');
    expect(focusOf(resolveHumanFixPrompt('Rename it.', []))).toBe('changes');
    expect(focusOf(resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null, []))).toBe('changes');
    expect(focusOf(resolvePullRequestFixPrompt(pullRequest({ number: 42 })))).toBe('pull_request');
    expect(focusOf(resolvePullRequestFixPrompt(pullRequest({ mergeable: false })))).toBe('conflicts');
    expect(focusOf(resolveUpdateConflictFixPrompt('main', ['a.ts']))).toBe('conflicts');
    expect(focusOf(resolvePushHookFixPrompt('FAIL', null, null))).toBe('push_hook');
  });

  test('a conflict from updating onto the base lists the files, merges and never rebases', () => {
    const prompt = resolveUpdateConflictFixPrompt('feat/base', ['src/a.ts', 'src/b.ts']);
    expect(prompt).toStartWith(
      'The branch was being updated onto `feat/base` before Shinsa pushed it, and these files conflict:\n- src/a.ts\n- src/b.ts'
    );
    expect(prompt).toContain('merge it in with `git merge origin/feat/base`');
    expect(prompt).toContain('Never rebase or force-push.');
    expect(prompt).toContain(
      'Afterwards Shinsa runs the checks the resolved files touch, then updates the branch again and pushes it.'
    );
  });

  test('a hook fix fences the output past its own backticks and keeps the agent off the whole suite', () => {
    const prompt = resolvePushHookFixPrompt('see ```code``` here', ['a.test.ts › adds'], ' Look at a.ts. ');
    expect(prompt).toContain('````\nsee ```code``` here\n````');
    expect(prompt).toContain('The failures it names:\n- a.test.ts › adds');
    expect(prompt).toContain('never the whole suite the hook runs');
    expect(prompt).toContain('Guidance from the human: Look at a.ts.');
    expect(prompt).toContain('then pushes again, which runs the hook again.');
    expect(resolvePushHookFixPrompt('plain', [], null)).not.toContain('The failures it names');
  });

  test('a fix of the work says the checks and the review follow it', () => {
    expect(resolveHumanFixPrompt('Rename it.', [])).toContain(
      'Afterwards Shinsa runs those checks, then the agent review where the task has one, and then the human reviews the work.'
    );
    expect(resolveHumanFixPrompt('Start the dev server so I can try it.', [])).toContain(
      'Start the dev server so I can try it.\n\nWhen it asks you to run or start something so the human can try the work (a dev server, a service), to check something or to answer a question, rather than to change the work, do that, say what you did in the summary, and call `complete_fix` all the same.'
    );
  });

  test('a checks fix names each failing check by id, leaves out what fails on the base branch, and says what comes next', () => {
    const results = [
      { id: 'c1', label: 'Panel tests', command: 'bun test src/panel', outcome: 'fail', detail: 'boom' },
      {
        id: 'c2',
        label: 'Engine tests',
        command: 'bun test apps/engine/test/a',
        outcome: 'fail',
        detail: 'old',
        note: 'fails_on_base',
      },
      {
        id: 'c3',
        label: 'Types',
        command: 'bun run --cwd apps/web check-types',
        outcome: 'pass',
        detail: null,
      },
    ] as const;
    const building = resolveChecksFixPrompt([...results], true);
    expect(building).toContain('- c1, Panel tests: `bun test src/panel` failed:\n```\nboom\n```');
    expect(building).not.toContain('Engine tests');
    expect(building).toContain('Afterwards Shinsa runs those checks, then you build the next phase.');
    expect(resolveChecksFixPrompt([...results], false)).toContain(
      'then the agent review where the task has one'
    );
  });

  test('every fix prompt says when to send the parts of the walkthrough that changed', () => {
    for (const prompt of [
      resolveChecksFixPrompt(
        [{ id: 'c1', label: 'Tests', command: 'bun test src/a', outcome: 'fail', detail: '' }],
        false
      ),
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
    expect(resolvePullRequestFixPrompt(conflicting)).toStartWith(
      'The pull request conflicts with `main`, so the human cannot merge #42 until you resolve the conflicts.'
    );
    expect(resolvePullRequestFixPrompt({ ...conflicting, base: undefined })).toStartWith(
      'The pull request conflicts with its base, so'
    );
    expect(resolvePullRequestFixPrompt(conflicting)).toContain(
      '- The branch has merge conflicts with its base, `main`. Shinsa fetched it: merge it in with `git merge origin/main`, resolve every conflict and `git add` the files. Leave the merge uncommitted: Shinsa commits it with your fix. Never rebase or force-push.'
    );
    expect(resolvePullRequestFixPrompt({ ...conflicting, base: undefined })).toContain(
      'Fetch the base branch, merge it in with `git merge`'
    );
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
