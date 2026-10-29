import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Round, Task } from '@shinsa/core';
import {
  createPullRequest,
  mergePullRequest,
  type PullRequestDetails,
  readPullRequest,
  resolveCheckRuns,
  resolveCheckRunsState,
  resolveChecks,
  resolveRemarks,
  resolveRepoSlug,
  retargetPullRequest,
  serializePullRequest,
  serializePullRequestBody,
  serializePullRequestTitle,
} from '../../src/github/index.ts';
import { createGitRepo, createTempDir, git, overrideEnv } from '../helpers/index.ts';
import { createRepo, createTask } from '../helpers/state.ts';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

interface FakePull {
  number: number;
  head: string;
  base: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  checks: 'pending' | 'passing' | 'failing' | 'none';
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
  unresolved: number;
  mergedWith: string | null;
  title?: string;
  mergeCommit?: string | null;
  reviewDecision?: string | null;
  comments?: { id: string; author: string | null; createdAt: string; body: string }[];
  queue?: { state: string; position: number | null } | null;
}

function useFakeGitHub(pulls: FakePull[] = [], extra: { mergeQueue?: boolean; failReads?: number } = {}) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(
    path,
    JSON.stringify({ next: pulls.length + 1, defaultChecks: 'pending', pulls, calls: [], ...extra })
  );
  restore = overrideEnv({ FAKE_GH_STATE: path });
  return { read: () => JSON.parse(readFileSync(path, 'utf8')) as { pulls: FakePull[]; calls: string[][] } };
}

const pull: FakePull = {
  number: 7,
  head: 'fix/tab-scroll',
  base: 'main',
  state: 'OPEN',
  checks: 'passing',
  mergeable: 'MERGEABLE',
  unresolved: 2,
  mergedWith: null,
};

type DetailsPull = PullRequestDetails['repository']['pullRequest'];

function createDetails(
  overrides: Partial<DetailsPull> = {},
  viewer: string | null = 'me'
): PullRequestDetails {
  return {
    viewer: viewer ? { login: viewer } : null,
    repository: {
      pullRequest: {
        author: { login: 'author' },
        mergeQueueEntry: null,
        autoMergeRequest: null,
        commits: { nodes: [] },
        comments: { totalCount: 0, nodes: [] },
        reviews: { totalCount: 0, nodes: [] },
        reviewThreads: { totalCount: 0, nodes: [] },
        timelineItems: { nodes: [] },
        ...overrides,
      },
    },
  };
}

const comment = (id: string, createdAt: string, author: string | null = 'bot') => ({
  id,
  author: author ? { login: author } : null,
  createdAt,
  lastEditedAt: null,
  body: `said ${id}`,
  url: null,
});

describe('resolveChecks', () => {
  test('any failure fails, anything pending is pending, nothing is none', () => {
    expect(resolveChecks(null)).toBe('none');
    expect(resolveChecks([])).toBe('none');
    expect(resolveChecks([{ conclusion: 'SUCCESS' }, { state: 'ERROR' }])).toBe('failing');
    expect(resolveChecks([{ status: 'QUEUED' }])).toBe('pending');
    expect(resolveChecks([{ state: 'PENDING' }])).toBe('pending');
    expect(resolveChecks([{ conclusion: 'SUCCESS' }, {}])).toBe('passing');
  });
});

describe('checks per name', () => {
  test('check runs and status contexts map to one status each, with their link and whether they are required', () => {
    expect(
      resolveCheckRuns([
        { __typename: 'CheckRun', name: 'lint', status: 'IN_PROGRESS', isRequired: true },
        {
          __typename: 'CheckRun',
          name: 'test',
          status: 'COMPLETED',
          conclusion: 'TIMED_OUT',
          detailsUrl: 'u',
        },
        { __typename: 'CheckRun', name: 'odd', status: 'COMPLETED', conclusion: 'SOMETHING_NEW' },
        { __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
        {
          __typename: 'StatusContext',
          context: 'deploy',
          state: 'SUCCESS',
          targetUrl: 't',
          isRequired: false,
        },
        { __typename: 'StatusContext', context: 'expected', state: 'EXPECTED' },
      ])
    ).toEqual([
      { name: 'lint', status: 'pending', required: true, url: null },
      { name: 'test', status: 'failure', required: null, url: 'u' },
      { name: 'odd', status: 'neutral', required: null, url: null },
      { name: 'check', status: 'action_required', required: null, url: null },
      { name: 'deploy', status: 'success', required: false, url: 't' },
      { name: 'expected', status: 'pending', required: null, url: null },
    ]);
  });

  test('any failed check fails; otherwise only the required checks decide pending, or every check when none is required', () => {
    const check = (status: 'pending' | 'success' | 'cancelled', required: boolean | null) => ({
      name: `${status}-${required}`,
      status,
      required,
      url: null,
    });
    expect(resolveCheckRunsState([])).toBe('none');
    expect(resolveCheckRunsState([check('success', true), check('cancelled', false)])).toBe('failing');
    expect(resolveCheckRunsState([check('success', true), check('pending', false)])).toBe('passing');
    expect(resolveCheckRunsState([check('pending', true), check('success', false)])).toBe('pending');
    expect(resolveCheckRunsState([check('pending', null)])).toBe('pending');
    expect(resolveCheckRunsState([check('success', null)])).toBe('passing');
  });
});

describe('serializePullRequest', () => {
  const view = {
    number: 1,
    url: 'u',
    state: 'OPEN' as const,
    mergeable: 'UNKNOWN' as const,
    reviewDecision: null,
    baseRefName: 'main',
    statusCheckRollup: null,
  };

  test('without details it maps states, mergeability and the rollup, and a change request counts once', () => {
    expect(serializePullRequest(view, null, 5)).toEqual({
      number: 1,
      url: 'u',
      base: 'main',
      state: 'open',
      checks: 'none',
      unresolvedComments: 0,
      mergeable: null,
      headSha: null,
      mergeCommit: null,
      updatedAt: 5,
    });
    expect(serializePullRequest({ ...view, state: 'MERGED', mergeable: 'MERGEABLE' }, null, 5)).toMatchObject(
      {
        state: 'merged',
        mergeable: true,
      }
    );
    expect(
      serializePullRequest({ ...view, state: 'CLOSED', mergeable: 'CONFLICTING' }, null, 5)
    ).toMatchObject({ state: 'closed', mergeable: false });
    expect(
      serializePullRequest({ ...view, reviewDecision: 'CHANGES_REQUESTED' }, null, 5).unresolvedComments
    ).toBe(1);
  });

  test('details add the checks per name, the unresolved threads and the merge queue', () => {
    const thread = (id: string, isResolved: boolean, isOutdated: boolean) => ({
      id,
      isResolved,
      isOutdated,
      path: 'a.ts',
      comments: { totalCount: 0, nodes: [] },
    });
    const details = createDetails({
      mergeQueueEntry: { state: 'AWAITING_CHECKS', position: 2 },
      commits: {
        nodes: [
          {
            commit: {
              statusCheckRollup: {
                contexts: {
                  nodes: [{ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }],
                },
              },
            },
          },
        ],
      },
      reviewThreads: {
        totalCount: 3,
        nodes: [
          thread('open', false, false),
          thread('resolved', true, false),
          thread('outdated', false, true),
        ],
      },
      timelineItems: { nodes: [{ reason: 'FAILED_CHECKS' }] },
    });
    expect(serializePullRequest({ ...view, reviewDecision: 'CHANGES_REQUESTED' }, details, 5)).toMatchObject({
      checks: 'failing',
      checkRuns: [{ name: 'ci', status: 'failure', required: null, url: null }],
      unresolvedComments: 1,
      unresolvedThreads: ['open'],
      mergeQueue: { state: 'awaiting_checks', position: 2 },
      queueRemoval: 'failed checks',
    });
  });

  test('auto-merge counts as a queue, a written reason is kept as it is, and an unknown queue state is no queue', () => {
    const auto = createDetails({
      autoMergeRequest: { enabledAt: 'now' },
      timelineItems: { nodes: [{ reason: 'The merge group failed its checks.' }] },
    });
    expect(serializePullRequest(view, auto, 5)).toMatchObject({
      mergeQueue: { state: 'auto_merge', position: null },
      queueRemoval: 'The merge group failed its checks.',
      checks: 'none',
    });
    const unknown = createDetails({ mergeQueueEntry: { state: 'SOMETHING_NEW', position: 1 } });
    expect(serializePullRequest(view, unknown, 5)).toMatchObject({ mergeQueue: null, queueRemoval: null });
  });

  test('the body names the Shinsa task first, by handle when it has one', () => {
    expect(serializePullRequestBody(createTask({ handle: 'LOC-22', summary: 'Did it.' }))).toBe(
      'Shinsa task: LOC-22, `shinsa://task/task-1`\n\nDid it.'
    );
    expect(serializePullRequestBody(createTask())).toBe('Shinsa task: `shinsa://task/task-1`');
  });

  test('the title is a conventional commit subject from the branch type and the current round', () => {
    expect(serializePullRequestTitle(createTask({ title: 'Fix the tab scroll' }))).toBe(
      'fix: the tab scroll'
    );
    expect(serializePullRequestTitle(createTask({ branch: 'docs/readme', title: 'Explain setup' }))).toBe(
      'docs: explain setup'
    );
    const round = (number: number, title: string, status: Round['status']) =>
      ({ number, title, status, startedAt: number }) as Round;
    const later = createTask({
      branch: 'feat/export-round-2',
      rounds: [round(1, 'Add the export', 'merged'), round(2, 'Export to CSV too', 'active')],
    });
    expect(serializePullRequestTitle(later)).toBe('feat: export to CSV too');
  });

  test('the body carries the summary and the plan', () => {
    expect(serializePullRequestBody(createTask({ summary: 'Did it.' }))).toBe(
      'Shinsa task: `shinsa://task/task-1`\n\nDid it.'
    );
    expect(serializePullRequestBody(createTask({ plan: { body: 'The plan' } as Task['plan'] }))).toContain(
      '<details><summary>Plan</summary>\n\nThe plan\n</details>'
    );
    const step = {
      when: 'pre_merge' as const,
      kind: 'env' as const,
      title: 'Set A',
      detail: 'In production.',
      command: null,
    };
    const walkthrough = {
      approach: 'a',
      flow: 'f',
      risks: [],
      testing: { automated: ['a.test.ts covers it.'], manual: [] },
      steps: [step],
    };
    expect(
      serializePullRequestBody(
        createTask({
          summary: 'Did it.',
          phaseReports: [{ index: 0, summary: 's', spots: [], judgementCalls: [], walkthrough, at: 0 }],
        })
      )
    ).toBe(
      'Shinsa task: `shinsa://task/task-1`\n\nDid it.\n\n### How to test\n**Covered by tests**\n- a.test.ts covers it.\n\n### Pre-merge steps\n- [ ] **Set A**: In production.'
    );
  });
});

describe('the comments a watch reads', () => {
  test('comments, meaningful reviews and thread comments are read together, oldest first', () => {
    const details = createDetails({
      comments: { totalCount: 1, nodes: [comment('c1', '2026-01-01T00:00:03Z', null)] },
      reviews: {
        totalCount: 4,
        nodes: [
          {
            ...comment('r1', '', 'human'),
            submittedAt: '2026-01-01T00:00:01Z',
            state: 'CHANGES_REQUESTED',
            body: '',
          },
          {
            ...comment('r2', '', 'bot'),
            submittedAt: '2026-01-01T00:00:02Z',
            state: 'COMMENTED',
            body: 'Summary',
          },
          { ...comment('r3', '', 'bot'), submittedAt: '2026-01-01T00:00:02Z', state: 'COMMENTED', body: ' ' },
          { ...comment('r4', '', 'bot'), submittedAt: null, state: 'PENDING', body: 'draft' },
        ],
      },
      reviewThreads: {
        totalCount: 1,
        nodes: [
          {
            id: 't1',
            isResolved: false,
            isOutdated: false,
            path: 'src/a.ts',
            comments: { totalCount: 1, nodes: [comment('tc1', '2026-01-01T00:00:00Z')] },
          },
        ],
      },
    });
    expect(
      resolveRemarks(details)?.map((remark) => [remark.id, remark.author, remark.path, remark.reviewState])
    ).toEqual([
      ['tc1', 'bot', 'src/a.ts', null],
      ['r1', 'human', null, 'changes requested'],
      ['r2', 'bot', null, 'commented'],
      ['c1', null, null, null],
    ]);
  });

  test('a read that could not list every comment, review, thread or thread reply is incomplete', () => {
    const truncated = (overrides: Partial<DetailsPull>) => resolveRemarks(createDetails(overrides));
    expect(truncated({ comments: { totalCount: 101, nodes: [] } })).toBeNull();
    expect(truncated({ reviews: { totalCount: 1, nodes: [] } })).toBeNull();
    expect(truncated({ reviewThreads: { totalCount: 1, nodes: [] } })).toBeNull();
    expect(
      truncated({
        reviewThreads: {
          totalCount: 1,
          nodes: [
            {
              id: 't',
              isResolved: false,
              isOutdated: false,
              path: null,
              comments: { totalCount: 60, nodes: [] },
            },
          ],
        },
      })
    ).toBeNull();
    expect(truncated({})).toEqual([]);
  });
});

describe('resolveRepoSlug', () => {
  test('reads the owner and name from the remote', () => {
    expect(resolveRepoSlug(createRepo())).toEqual({ owner: 'acme', name: 'app' });
    expect(resolveRepoSlug(createRepo({ remote: null }))).toBeNull();
  });
});

describe('the gh calls', () => {
  test('a pull request is read by number or branch, with its threads, comments and who is reading', async () => {
    useFakeGitHub([
      { ...pull, comments: [{ id: 'c1', author: 'bot', createdAt: '2026-01-02T00:00:00Z', body: 'Hi' }] },
    ]);
    const { repo } = await createGitRepo({ remote: false });
    const github = { ...repo, remote: 'github.com/acme/app' };
    const read = await readPullRequest(github, createTask());
    expect(read?.pullRequest).toMatchObject({
      number: 7,
      checks: 'passing',
      unresolvedComments: 2,
      unresolvedThreads: ['thread-7-0', 'thread-7-1'],
      checkRuns: [{ name: 'ci', status: 'success', required: false }],
    });
    expect(read?.remarks?.map((remark) => remark.id)).toEqual([
      'thread-comment-7-0',
      'thread-comment-7-1',
      'c1',
    ]);
    expect(read?.viewer).toBe('shinsa-user');
    expect(
      (await readPullRequest(github, createTask({ pullRequest: { number: 7 } as Task['pullRequest'] })))
        ?.pullRequest
    ).toMatchObject({ number: 7 });
    expect(await readPullRequest(github, createTask({ branch: 'fix/other' }))).toBeNull();
    expect(await readPullRequest(github, createTask({ branch: null }))).toBeNull();
  });

  test('without a GitHub remote only the view is read: no threads, no comments, nobody reading', async () => {
    useFakeGitHub([pull]);
    const { repo } = await createGitRepo({ remote: false });
    const read = await readPullRequest({ ...repo, remote: null }, createTask());
    expect(read).toEqual({
      pullRequest: expect.objectContaining({ unresolvedComments: 0, checks: 'passing' }),
      remarks: null,
      viewer: null,
    });
    expect(read?.pullRequest.unresolvedThreads).toBeUndefined();
  });

  test('a read GitHub refuses is an error, not a missing pull request', async () => {
    useFakeGitHub([pull], { failReads: 1 });
    const { repo } = await createGitRepo({ remote: false });
    const github = { ...repo, remote: 'github.com/acme/app' };
    await expect(readPullRequest(github, createTask())).rejects.toThrow('gh pr view failed: HTTP 502');
    const restorePath = overrideEnv({ PATH: `${createFailingGraphql()}:${process.env.PATH ?? ''}` });
    try {
      await expect(readPullRequest(github, createTask())).rejects.toThrow(
        'gh api graphql failed: rate limited'
      );
    } finally {
      restorePath();
    }
  });

  test('merging names the commit you approved, and GitHub refuses it once the branch moved on', async () => {
    const { repo, path } = await createGitRepo({ remote: false });
    const head = (await git(path, 'rev-parse', 'HEAD')).trim();
    const branch = (await git(path, 'branch', '--show-current')).trim();
    const github = useFakeGitHub([
      { ...pull, head: branch },
      { ...pull, number: 8, head: branch },
    ]);
    const restoreOrigin = overrideEnv({ FAKE_GH_ORIGIN: path });
    try {
      await expect(mergePullRequest(repo, 7, 'squash', 'c0ffee0')).rejects.toThrow(
        'Head branch was modified'
      );
      await mergePullRequest(repo, 8, 'squash', head);
    } finally {
      restoreOrigin();
    }
    const calls = github.read().calls.filter((call) => call[1] === 'merge');
    expect(calls.at(-1)).toEqual(['pr', 'merge', '8', '--squash', '--match-head-commit', head]);
    expect(github.read().pulls.map((entry) => entry.state)).toEqual(['OPEN', 'MERGED']);
  });

  test('a squash or merge commit takes the pull request title and number as its subject, with no body', async () => {
    const { repo } = await createGitRepo({ remote: false });
    const github = useFakeGitHub([
      { ...pull, title: 'fix: the tab scroll' },
      { ...pull, number: 8, title: 'feat: add search' },
      { ...pull, number: 9, title: 'docs: explain setup' },
      { ...pull, number: 10 },
    ]);
    await mergePullRequest(repo, 7, 'squash', null);
    await mergePullRequest(repo, 8, 'merge', null);
    await mergePullRequest(repo, 9, 'rebase', null);
    await mergePullRequest(repo, 10, 'squash', null);
    expect(github.read().calls.filter((call) => call[1] === 'merge')).toEqual([
      ['pr', 'merge', '7', '--squash', '--subject', 'fix: the tab scroll (#7)', '--body', ''],
      ['pr', 'merge', '8', '--merge', '--subject', 'feat: add search (#8)', '--body', ''],
      ['pr', 'merge', '9', '--rebase'],
      ['pr', 'merge', '10', '--squash'],
    ]);
  });

  test('opening reuses an open pull request, otherwise creates one against the right base', async () => {
    const github = useFakeGitHub([pull]);
    const { repo, path } = await createGitRepo({ remote: false });
    const task = createTask({ worktreePath: path, summary: 'Summary' });
    expect((await createPullRequest(repo, task, null))?.pullRequest).toMatchObject({ number: 7 });
    const created = await createPullRequest(
      repo,
      createTask({ worktreePath: path, branch: 'feat/new' }),
      'feat/base'
    );
    expect(created?.pullRequest).toMatchObject({ number: 2, base: 'feat/base' });
    const create = github.read().calls.find((call) => call[1] === 'create');
    expect(create).toContain('feat/new');
    expect(create?.[(create?.indexOf('--title') ?? 0) + 1]).toBe('feat: fix the tab scroll');
    await expect(createPullRequest(repo, createTask({ worktreePath: null }), null)).rejects.toThrow(
      'no branch'
    );
  });

  test('a merged pull request is read with the commit it merged as, an open one with none', async () => {
    const merged = 'c0ffee0123456789abcdef0123456789abcdef01';
    useFakeGitHub([
      { ...pull, state: 'MERGED', mergeCommit: merged },
      { ...pull, number: 8, head: 'fix/other' },
    ]);
    const { repo } = await createGitRepo({ remote: false });
    const local = { ...repo, remote: null };
    const read = await readPullRequest(local, createTask());
    expect(read?.pullRequest).toMatchObject({ state: 'merged', mergeCommit: merged });
    const open = await readPullRequest(local, createTask({ branch: 'fix/other' }));
    expect(open?.pullRequest).toMatchObject({ number: 8, state: 'open', mergeCommit: null });
  });

  test('retargeting and merging, with only the known merge methods', async () => {
    const github = useFakeGitHub([pull]);
    const { repo } = await createGitRepo({ remote: false });
    await retargetPullRequest(repo, 7, 'develop');
    await mergePullRequest(repo, 7, 'squash', null);
    expect(github.read().pulls[0]).toMatchObject({
      base: 'develop',
      state: 'MERGED',
      mergedWith: '--squash',
    });
    await expect(mergePullRequest(repo, 7, '--admin' as 'squash', null)).rejects.toThrow(
      'is not a merge method'
    );
    await expect(mergePullRequest(repo, 7, 'squash', '--admin')).rejects.toThrow('is not a commit');
    await expect(retargetPullRequest(repo, 7, '--evil')).rejects.toThrow('is not a branch name');
  });
});

function createFailingGraphql() {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(
    join(dir, 'gh'),
    `#!/bin/sh\nif [ "$1" = "api" ]; then echo "rate limited" >&2; exit 1; fi\nexec "${real}" "$@"\n`,
    { mode: 0o755 }
  );
  return dir;
}
