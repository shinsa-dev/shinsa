import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Task } from '@shinsa/core';
import {
  createPullRequest,
  mergePullRequest,
  resolveChecks,
  resolveRepoSlug,
  retargetPullRequest,
  selectPullRequest,
  serializePullRequest,
  serializePullRequestBody,
} from '../../src/github/index.ts';
import { createGitRepo, createTempDir, overrideEnv } from '../helpers/index.ts';
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
  reviewDecision?: string | null;
}

function useFakeGitHub(pulls: FakePull[] = []) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: pulls.length + 1, defaultChecks: 'pending', pulls, calls: [] }));
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

  test('maps states, mergeability and a change request without threads', () => {
    expect(serializePullRequest(view, 0, 5)).toMatchObject({
      state: 'open',
      mergeable: null,
      headSha: null,
      updatedAt: 5,
    });
    expect(serializePullRequest({ ...view, state: 'MERGED', mergeable: 'MERGEABLE' }, 0, 5)).toMatchObject({
      state: 'merged',
      mergeable: true,
    });
    expect(serializePullRequest({ ...view, state: 'CLOSED', mergeable: 'CONFLICTING' }, 0, 5)).toMatchObject({
      state: 'closed',
      mergeable: false,
    });
    expect(
      serializePullRequest({ ...view, reviewDecision: 'CHANGES_REQUESTED' }, 0, 5).unresolvedComments
    ).toBe(1);
    expect(
      serializePullRequest({ ...view, reviewDecision: 'CHANGES_REQUESTED' }, 3, 5).unresolvedComments
    ).toBe(3);
  });

  test('the body carries the summary and the spec', () => {
    expect(serializePullRequestBody(createTask({ summary: 'Did it.' }))).toBe('Did it.');
    expect(serializePullRequestBody(createTask({ spec: { body: 'The plan' } as Task['spec'] }))).toContain(
      '<details><summary>Spec</summary>\n\nThe plan\n</details>'
    );
  });
});

describe('resolveRepoSlug', () => {
  test('reads the owner and name from the remote', () => {
    expect(resolveRepoSlug(createRepo())).toEqual({ owner: 'acme', name: 'app' });
    expect(resolveRepoSlug(createRepo({ remote: null }))).toBeNull();
  });
});

describe('the gh calls', () => {
  test('a pull request is read by number or branch, with its unresolved threads', async () => {
    useFakeGitHub([pull]);
    const { repo } = await createGitRepo({ remote: false });
    const github = { ...repo, remote: 'github.com/acme/app' };
    expect(await selectPullRequest(github, createTask())).toMatchObject({
      number: 7,
      checks: 'passing',
      unresolvedComments: 2,
    });
    expect(
      await selectPullRequest(github, createTask({ pullRequest: { number: 7 } as Task['pullRequest'] }))
    ).toMatchObject({ number: 7 });
    expect(await selectPullRequest({ ...github, remote: null }, createTask())).toMatchObject({
      unresolvedComments: 0,
    });
    expect(await selectPullRequest(github, createTask({ branch: 'fix/other' }))).toBeNull();
    expect(await selectPullRequest(github, createTask({ branch: null }))).toBeNull();
  });

  test('a failing thread query counts as none', async () => {
    useFakeGitHub([pull]);
    const { repo } = await createGitRepo({ remote: false });
    const restorePath = overrideEnv({ PATH: `${createFailingGraphql()}:${process.env.PATH ?? ''}` });
    try {
      expect(await selectPullRequest({ ...repo, remote: 'github.com/acme/app' }, createTask())).toMatchObject(
        { unresolvedComments: 0 }
      );
    } finally {
      restorePath();
    }
  });

  test('opening reuses an open pull request, otherwise creates one against the right base', async () => {
    const github = useFakeGitHub([pull]);
    const { repo, path } = await createGitRepo({ remote: false });
    const task = createTask({ worktreePath: path, summary: 'Summary' });
    expect(await createPullRequest(repo, task, null)).toMatchObject({ number: 7 });
    const created = await createPullRequest(
      repo,
      createTask({ worktreePath: path, branch: 'feat/new' }),
      'feat/base'
    );
    expect(created).toMatchObject({ number: 2, base: 'feat/base' });
    expect(github.read().calls.find((call) => call[1] === 'create')).toContain('feat/new');
    expect(createPullRequest(repo, createTask({ worktreePath: null }), null)).rejects.toThrow('no branch');
  });

  test('retargeting and merging, with only the known merge methods', async () => {
    const github = useFakeGitHub([pull]);
    const { repo } = await createGitRepo({ remote: false });
    await retargetPullRequest(repo, 7, 'develop');
    await mergePullRequest(repo, 7, 'squash');
    expect(github.read().pulls[0]).toMatchObject({
      base: 'develop',
      state: 'MERGED',
      mergedWith: '--squash',
    });
    expect(mergePullRequest(repo, 7, '--admin' as 'squash')).rejects.toThrow('is not a merge method');
    expect(retargetPullRequest(repo, 7, '--evil')).rejects.toThrow('is not a branch name');
  });
});

function createFailingGraphql() {
  const dir = createTempDir();
  const real = join(import.meta.dirname, '../helpers/bin/gh');
  writeFileSync(join(dir, 'gh'), `#!/bin/sh\nif [ "$1" = "api" ]; then exit 1; fi\nexec "${real}" "$@"\n`, {
    mode: 0o755,
  });
  return dir;
}
