import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { parseIssueStates, parseIssueUrl, serializeFeedbackBody } from '../../src/feedback/answers.ts';
import { FeedbackIssues } from '../../src/feedback/issues/service.ts';
import type { FeedbackIssueInput } from '../../src/feedback/schema.ts';
import { edgeRuntime } from '../../src/runtime/edge.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';

function fileFeedbackIssue(input: FeedbackIssueInput, cwd: string) {
  return edgeRuntime.runPromise(
    FeedbackIssues.use((issues) => issues.file(input, cwd)).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, detail: error.message }),
        onSuccess: (issue) => ({ ok: true as const, issue }),
      })
    )
  );
}

function listFeedbackIssueStates(cwd: string) {
  return edgeRuntime.runPromise(
    FeedbackIssues.use((issues) => issues.listStates(cwd)).pipe(
      Effect.match({
        onFailure: (error) => ({ ok: false as const, detail: error.message }),
        onSuccess: (states) => ({ ok: true as const, states }),
      })
    )
  );
}

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

function useFakeGitHub(extra: Record<string, unknown> = {}) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: 1, defaultChecks: 'pending', pulls: [], calls: [], ...extra }));
  restore = overrideEnv({ FAKE_GH_STATE: path });
  return {
    read: () =>
      JSON.parse(readFileSync(path, 'utf8')) as {
        issues?: { repo: string; title: string; body: string }[];
        calls: string[][];
      },
  };
}

describe('opening a feedback issue', () => {
  test('creates the issue on shinsa-dev/shinsa with the body on stdin and reads its link', async () => {
    const github = useFakeGitHub();
    const filing = await fileFeedbackIssue(
      { source: 'agent', title: '--Plan tab hides changes', body: 'The plan tab hides them.' },
      createTempDir()
    );
    expect(filing).toEqual({
      ok: true,
      issue: { number: 1, url: 'https://github.com/shinsa-dev/shinsa/issues/1' },
    });
    expect(github.read().issues).toEqual([
      {
        number: 1,
        repo: 'shinsa-dev/shinsa',
        title: '--Plan tab hides changes',
        body: serializeFeedbackBody({ source: 'agent', title: '', body: 'The plan tab hides them.' }),
      },
    ] as never);
    expect(github.read().calls[0]).toContain('--title=--Plan tab hides changes');
  });

  test('ends the body with a line that says where it came from', () => {
    expect(serializeFeedbackBody({ source: 'human', title: 'T', body: 'Body.' })).toBe(
      'Body.\n\n---\n_Sent from the feedback button in Shinsa._\n'
    );
    expect(serializeFeedbackBody({ source: 'agent', title: 'T', body: 'Body.' })).toContain(
      'Reported by an agent working in Shinsa'
    );
  });

  test('reports what gh said when it fails, and a reply without a link', async () => {
    useFakeGitHub({ failIssues: 'To get started with GitHub CLI, please run: gh auth login' });
    const failed = await fileFeedbackIssue({ source: 'human', title: 'T', body: 'B' }, createTempDir());
    expect(failed).toEqual({
      ok: false,
      detail: 'gh issue create failed: To get started with GitHub CLI, please run: gh auth login',
    });
    expect(parseIssueUrl('Created.')).toBeNull();
    expect(
      parseIssueUrl('https://github.com/a/b/issues/3\nhttps://github.com/shinsa-dev/shinsa/issues/12')
    ).toEqual({ number: 12, url: 'https://github.com/shinsa-dev/shinsa/issues/12' });
  });
});

describe('reading the state of opened issues', () => {
  test('lists your issues on shinsa-dev/shinsa with when each closed', async () => {
    const github = useFakeGitHub({
      issues: [
        { number: 1, repo: 'shinsa-dev/shinsa', title: 'a', body: 'a' },
        { number: 2, repo: 'shinsa-dev/shinsa', title: 'b', body: 'b', closedAt: '2026-11-01T10:00:00Z' },
      ],
    });
    const listing = await listFeedbackIssueStates(createTempDir());
    expect(listing).toEqual({
      ok: true,
      states: new Map([
        [1, null],
        [2, Date.parse('2026-11-01T10:00:00Z')],
      ]),
    });
    expect(github.read().calls.at(-1)).toEqual([
      'issue',
      'list',
      '--repo',
      'shinsa-dev/shinsa',
      '--author',
      '@me',
      '--state',
      'all',
      '--limit',
      '500',
      '--json',
      'number,state,closedAt',
    ]);
  });

  test('a failure says what gh said, and an answer that is not a list is refused', async () => {
    useFakeGitHub({ failIssues: 'HTTP 401: Bad credentials' });
    expect(await listFeedbackIssueStates(createTempDir())).toEqual({
      ok: false,
      detail: 'gh issue list failed: HTTP 401: Bad credentials',
    });
    useFakeGitHub({ issuesListOutput: 'Not signed in' });
    expect(await listFeedbackIssueStates(createTempDir())).toEqual({
      ok: false,
      detail: 'GitHub answered without a list of issues: Not signed in',
    });
    expect(parseIssueStates('not json')).toBeNull();
    expect(parseIssueStates('{}')).toBeNull();
    expect(
      parseIssueStates(
        JSON.stringify([
          { number: 3, state: 'CLOSED', closedAt: 'never' },
          { number: 'x' },
          { number: 4, state: 'CLOSED' },
        ])
      )
    ).toEqual(
      new Map([
        [3, null],
        [4, null],
      ])
    );
  });
});
