import { describe, expect, it } from 'bun:test';
import type { ReferenceSpan, Task } from '@shinsa/core';
import {
  describeReference,
  isReferenceHref,
  resolveCatalog,
  selectBranchTask,
  selectPullRequestTask,
  selectRepo,
  splitReferenceText,
  transformUrl,
} from '@/lib/tasks/references.ts';
import { createRepo, createShinsaState, createTask, NOW } from '../../support/state.ts';

function pullRequest(number: number): NonNullable<Task['pullRequest']> {
  return {
    number,
    url: `https://github.com/acme/app/pull/${number}`,
    state: 'open',
    checks: 'passing',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: NOW,
  };
}

describe('resolveCatalog', () => {
  it('is empty without state', () => {
    expect(resolveCatalog(null)).toEqual({ tasks: [], pullRequests: [] });
  });

  it('lists tasks and pull requests, leaving cancelled tasks out', () => {
    const state = createShinsaState({
      tasks: [
        createTask({ id: 'a', title: 'Add login', repoId: 'app', pullRequest: pullRequest(4) }),
        createTask({ id: 'b', title: 'Old idea', stage: 'cancelled' }),
      ],
      repos: [createRepo({ id: 'app', name: 'acme/app' })],
    });
    expect(resolveCatalog(state)).toEqual({
      tasks: [{ id: 'a', title: 'Add login' }],
      pullRequests: [{ number: 4, repo: 'acme/app', taskId: 'a' }],
    });
  });

  it('hands back the same catalog while its contents stay the same', () => {
    const tasks = [createTask({ id: 'a', title: 'Add login' })];
    const first = resolveCatalog(createShinsaState({ tasks }));
    const state = createShinsaState({ tasks, patch: { seq: 9 } });
    expect(resolveCatalog(state)).toBe(first);
    expect(resolveCatalog(state)).toBe(first);
    const renamed = resolveCatalog(
      createShinsaState({ tasks: [{ ...tasks[0], title: 'Add sign in' } as Task] })
    );
    expect(renamed).not.toBe(first);
    expect(renamed.tasks[0]?.title).toBe('Add sign in');
  });
});

describe('isReferenceHref', () => {
  it('recognises shinsa links in any case', () => {
    expect(isReferenceHref('shinsa://task/a')).toBe(true);
    expect(isReferenceHref('SHINSA://task/a')).toBe(true);
    expect(isReferenceHref('https://example.com')).toBe(false);
    expect(isReferenceHref(undefined)).toBe(false);
  });
});

describe('selectPullRequestTask', () => {
  const repos = [createRepo({ id: 'app', name: 'app' }), createRepo({ id: 'web', name: 'web' })];
  const inApp = createTask({ id: 'in-app', repoId: 'app', pullRequest: pullRequest(12) });
  const inWeb = createTask({ id: 'in-web', repoId: 'web', pullRequest: pullRequest(12) });
  const noRepo = createTask({ id: 'no-repo', pullRequest: pullRequest(30) });
  const state = createShinsaState({ tasks: [inApp, inWeb, noRepo], repos });

  it('finds the one task with that number', () => {
    expect(selectPullRequestTask(state, null, 30, null)?.id).toBe('no-repo');
    expect(selectPullRequestTask(state, null, 99, null)).toBeNull();
  });

  it('tells pull requests with the same number apart by repository, bare or with its owner', () => {
    expect(selectPullRequestTask(state, 'app', 12, null)?.id).toBe('in-app');
    expect(selectPullRequestTask(state, 'acme/web', 12, null)?.id).toBe('in-web');
    expect(selectPullRequestTask(state, 'other', 12, null)).toBeNull();
    expect(selectPullRequestTask(state, 'app', 30, null)).toBeNull();
  });

  it('falls back to the scoped task when the number alone is ambiguous', () => {
    expect(selectPullRequestTask(state, null, 12, null)).toBeNull();
    expect(selectPullRequestTask(state, null, 12, 'in-web')?.id).toBe('in-web');
    expect(selectPullRequestTask(state, null, 12, 'no-repo')).toBeNull();
  });
});

describe('selectRepo', () => {
  it('matches a repository by name, bare or with its owner', () => {
    const state = createShinsaState({ repos: [createRepo({ id: 'app', name: 'app' })] });
    expect(selectRepo(state, 'app')?.id).toBe('app');
    expect(selectRepo(state, 'acme/app')?.id).toBe('app');
    expect(selectRepo(state, 'acme/mapp')).toBeNull();
  });
});

describe('selectBranchTask', () => {
  const first = createTask({ id: 'first', branch: 'fix/tabs' });
  const second = createTask({ id: 'second', branch: 'fix/tabs' });
  const lone = createTask({ id: 'lone', branch: 'feat/lone' });
  const state = createShinsaState({ tasks: [first, second, lone] });

  it('finds the only task on a branch', () => {
    expect(selectBranchTask(state, 'feat/lone', null)?.id).toBe('lone');
    expect(selectBranchTask(state, 'feat/none', null)).toBeNull();
  });

  it('prefers the scoped task and gives up when several share the branch', () => {
    expect(selectBranchTask(state, 'fix/tabs', 'second')?.id).toBe('second');
    expect(selectBranchTask(state, 'fix/tabs', null)).toBeNull();
    expect(selectBranchTask(state, 'fix/tabs', 'lone')).toBeNull();
  });
});

describe('describeReference', () => {
  it('labels each kind of reference', () => {
    expect(describeReference({ kind: 'task', id: 'a' })).toBe('shinsa://task/a');
    expect(describeReference({ kind: 'pr', repo: 'app', number: 4 })).toBe('#4');
    expect(describeReference({ kind: 'repo', name: 'acme/app' })).toBe('acme/app');
    expect(describeReference({ kind: 'branch', name: 'fix/tabs' })).toBe('fix/tabs');
    expect(describeReference({ kind: 'file', path: 'src/app.ts', line: 3, end: null })).toBe('src/app.ts');
  });
});

describe('splitReferenceText', () => {
  function span(start: number, end: number): ReferenceSpan {
    return { start, end, label: 'x', reference: { kind: 'pr', repo: null, number: 1 }, source: 'number' };
  }

  it('keeps the text between, before and after references', () => {
    const text = 'See #1 and #2 now';
    const parts = splitReferenceText(text, [span(4, 6), span(11, 13)]);
    expect(parts.map((part) => (part.kind === 'text' ? part.text : `[${part.span.start}]`))).toEqual([
      'See ',
      '[4]',
      ' and ',
      '[11]',
      ' now',
    ]);
  });

  it('adds no empty text around references at the edges or side by side', () => {
    const parts = splitReferenceText('#1#2', [span(0, 2), span(2, 4)]);
    expect(parts.map((part) => part.kind)).toEqual(['reference', 'reference']);
    expect(splitReferenceText('plain', [])).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(splitReferenceText('', [])).toEqual([]);
  });
});

describe('transformUrl', () => {
  it('keeps shinsa links that markdown would otherwise strip', () => {
    expect(transformUrl('shinsa://task/a')).toBe('shinsa://task/a');
  });

  it('keeps safe links and strips unsafe ones', () => {
    expect(transformUrl('https://example.com/a')).toBe('https://example.com/a');
    expect(transformUrl('javascript:alert(1)')).toBe('');
  });
});
