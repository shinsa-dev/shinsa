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
    expect(resolveHumanFixPrompt('Rename it.', [])).toStartWith('The human looked at the work');
    expect(resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], null, [])).toStartWith(
      'The human looked at the work'
    );
    expect(resolvePullRequestFixPrompt(pullRequest({ number: 42 }))).toStartWith('Pull request #42');
  });

  test('a fix of the work says the checks and the review follow it', () => {
    expect(resolveHumanFixPrompt('Rename it.', [])).toContain(
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
    suggestion: { original: 'const x = 1;\nconst y = x;', replacement: 'const count = 1;\nconst y = count;' },
  };

  test('a suggested change carries its path, lines, the original text and the replacement verbatim', () => {
    const prompt = resolveHumanFixPrompt('Tidy the names.', [rename]);
    expect(prompt).toContain('The human looked at the work and wrote:\n\nTidy the names.\n\nLine comments:');
    expect(prompt).toContain(
      [
        '- src/a.ts, lines 12-13: Name it for what it holds.',
        'Suggested change to lines 12-13. Apply it as written unless that breaks something. Replace:',
        '```\nconst x = 1;\nconst y = x;\n```',
        'with:',
        '```\nconst count = 1;\nconst y = count;\n```',
      ].join('\n')
    );
  });

  test('comments alone open the prompt without words of their own', () => {
    const prompt = resolveHumanFixPrompt(' ', [
      { path: 'src/b.ts', side: 'old', line: 4, endLine: null, text: 'Keep this line.', suggestion: null },
    ]);
    expect(prompt).toStartWith('The human looked at the work and left line comments.\n\nLine comments:\n');
    expect(prompt).toContain('- src/b.ts, removed line 4: Keep this line.');
  });

  test('with neither words nor comments, the agent is asked to revise the work', () => {
    expect(resolveHumanFixPrompt(null, [])).toContain('wrote:\n\nRevise the work.');
  });

  test('a fence is longer than any run of backticks in the code it quotes', () => {
    const prompt = resolveHumanFixPrompt(null, [
      { ...rename, line: 3, endLine: null, text: '', suggestion: { original: 'a ``` b', replacement: '' } },
    ]);
    expect(prompt).toContain('- src/a.ts, line 3\nSuggested change to line 3.');
    expect(prompt).toContain('````\na ``` b\n````\nwith:\n```\n\n```');
  });

  test('a verdict prompt lists the line comments after your words', () => {
    const prompt = resolveVerdictFixPrompt([{ ...finding, verdict: 'fix' }], 'Also this.', [rename]);
    expect(prompt).toContain('The human also wrote:\nAlso this.\n\nLine comments:\n- src/a.ts, lines 12-13');
  });
});
