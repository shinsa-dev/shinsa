import { describe, expect, test } from 'bun:test';
import {
  PULL_REQUEST_WATCH_WAKE_LIMIT,
  resolvePullRequestSignature,
  trimWatchChanges,
} from '../../src/decide/watch.ts';
import type { CiRun, PullRequest, PullRequestRemark, PullRequestWatch, Task } from '../../src/index.ts';
import {
  CI_GRACE_MS,
  createPullRequestWatch,
  evaluatePullRequestWatch,
  isSamePullRequest,
  isSamePullRequestWatch,
  resolvePullRequestCi,
} from '../../src/index.ts';
import { pullRequest } from '../harness.ts';

const STARTED = '2026-10-02T12:00:00.000Z';

const watch = (overrides: Partial<PullRequestWatch> = {}): PullRequestWatch => ({
  ...createPullRequestWatch(1),
  remarksThrough: STARTED,
  ...overrides,
});

const check = (name: string, status: CiRun['status'], required: boolean | null = null): CiRun => ({
  name,
  status,
  required,
  url: `https://ci.example/${name}`,
});

const detail = (overrides: Partial<PullRequest> = {}): PullRequest =>
  pullRequest({
    headSha: 'aaaaaaaaaa',
    checkRuns: [check('lint', 'success'), check('test', 'pending')],
    mergeable: true,
    ...overrides,
  });

const remark = (login: string, createdAt: string, body = 'Please rename this.'): PullRequestRemark => ({
  id: `${login}-${createdAt}`,
  author: login,
  createdAt,
  editedAt: null,
  body,
  path: 'src/index.ts',
  url: `https://github.com/o/r/pull/1#${login}`,
  reviewState: null,
});

const VIEWER = 'agent-user';

const createTaskLike = (pushedAt: number | null) => ({ pushedAt }) as Task;

describe('whether no checks means no CI', () => {
  const none = detail({ checks: 'none', checkRuns: [] });
  const at = (repo: 'none' | 'workflows' | 'required' | 'unknown', now: number) => ({
    repo,
    since: 1_000,
    now,
  });

  test('a repository without CI has none at once; one with workflows only after the grace window', () => {
    expect(evaluatePullRequestWatch(watch(), none, [], VIEWER, at('none', 1_000)).next.ciAbsent).toBe(true);
    const early = evaluatePullRequestWatch(
      watch(),
      none,
      [],
      VIEWER,
      at('workflows', 1_000 + CI_GRACE_MS - 1)
    );
    expect(early.next.ciAbsent).toBe(false);
    expect(isSamePullRequestWatch(early.next, watch({ headSha: 'aaaaaaaaaa' }))).toBe(true);
    const late = evaluatePullRequestWatch(watch(), none, [], VIEWER, at('unknown', 1_000 + CI_GRACE_MS));
    expect(late.next.ciAbsent).toBe(true);
    expect(late.changes).toEqual([]);
  });

  test('required checks, a read without the repository, or checks on the head never count as no CI', () => {
    const later = 1_000 + CI_GRACE_MS * 10;
    expect(evaluatePullRequestWatch(watch(), none, [], VIEWER, at('required', later)).next.ciAbsent).toBe(
      false
    );
    expect(evaluatePullRequestWatch(watch(), none, [], VIEWER).next.ciAbsent).toBe(false);
    expect(evaluatePullRequestWatch(watch(), detail(), [], VIEWER, at('none', later)).next.ciAbsent).toBe(
      false
    );
  });

  test('once decided it holds for the head, and a new head decides again', () => {
    const decided = watch({ headSha: 'aaaaaaaaaa', ciAbsent: true });
    expect(evaluatePullRequestWatch(decided, none, [], VIEWER).next.ciAbsent).toBe(true);
    const moved = detail({ checks: 'none', checkRuns: [], headSha: 'bbbbbbbbbb' });
    expect(evaluatePullRequestWatch(decided, moved, [], VIEWER).next.ciAbsent).toBe(false);
  });

  test('the window starts at the task’s last push, else when the watch started', () => {
    const started = createPullRequestWatch(7);
    expect(resolvePullRequestCi(createTaskLike(null), started, 'workflows', 9)).toEqual({
      repo: 'workflows',
      since: 7,
      now: 9,
    });
    expect(resolvePullRequestCi(createTaskLike(5), started, 'none', 9).since).toBe(5);
  });
});

describe('evaluatePullRequestWatch', () => {
  test('reports each failure at once, even while another check never finishes', () => {
    const bot = check('CodeRabbit', 'pending');
    const first = detail({ checkRuns: [check('lint', 'failure'), check('test', 'pending'), bot] });
    const lint = evaluatePullRequestWatch(watch(), first, [], VIEWER);
    expect(lint.changes).toEqual([{ kind: 'checks_failed', failed: [check('lint', 'failure')] }]);
    expect(evaluatePullRequestWatch(lint.next, first, [], VIEWER).changes).toEqual([]);

    const second = detail({ checkRuns: [check('lint', 'failure'), check('test', 'failure'), bot] });
    const failed = evaluatePullRequestWatch(lint.next, second, [], VIEWER);
    expect(failed.changes).toEqual([{ kind: 'checks_failed', failed: [check('test', 'failure')] }]);

    const rerun = evaluatePullRequestWatch(failed.next, first, [], VIEWER);
    expect(evaluatePullRequestWatch(rerun.next, second, [], VIEWER).changes).toHaveLength(1);

    const pushed = detail({ ...second, headSha: 'bbbbbbbbbb' });
    expect(evaluatePullRequestWatch(failed.next, pushed, [], VIEWER).changes).toHaveLength(1);
  });

  test('reports passed once the required checks pass, whatever the others do', () => {
    const green = detail({
      checkRuns: [check('test', 'success', true), check('lint', 'success', true), check('bot', 'pending')],
    });
    const passed = evaluatePullRequestWatch(watch(), green, [], VIEWER);
    expect(passed.changes).toEqual([{ kind: 'checks_passed', count: 2, required: true }]);
    expect(evaluatePullRequestWatch(passed.next, green, [], VIEWER).changes).toEqual([]);

    const plain = detail({ checkRuns: [check('test', 'success'), check('bot', 'pending')] });
    expect(evaluatePullRequestWatch(watch(), plain, [], VIEWER).changes).toEqual([]);
  });

  test('reports passed again when a required check shows up already passed', () => {
    const tests = detail({ checkRuns: [check('Tests', 'success', true), check('Smoke Tests', 'pending')] });
    const first = evaluatePullRequestWatch(watch(), tests, [], VIEWER);
    expect(first.changes).toEqual([{ kind: 'checks_passed', count: 1, required: true }]);

    const gated = detail({
      checkRuns: [
        check('Tests', 'success', true),
        check('Smoke Tests', 'success'),
        check('Smoke Tests Gate', 'success', true),
      ],
    });
    const second = evaluatePullRequestWatch(first.next, gated, [], VIEWER);
    expect(second.changes).toEqual([{ kind: 'checks_passed', count: 2, required: true }]);
    expect(evaluatePullRequestWatch(second.next, gated, [], VIEWER).changes).toEqual([]);

    const pending = detail({
      checkRuns: [check('Tests', 'success', true), check('Smoke Tests Gate', 'pending', true)],
    });
    const waiting = evaluatePullRequestWatch(first.next, pending, [], VIEWER);
    expect(waiting.changes).toEqual([]);
    expect(evaluatePullRequestWatch(waiting.next, gated, [], VIEWER).changes).toEqual([
      { kind: 'checks_passed', count: 2, required: true },
    ]);
  });

  test('does not report passed again for a new passed check where none is required', () => {
    const first = evaluatePullRequestWatch(
      watch(),
      detail({ checkRuns: [check('test', 'success')] }),
      [],
      VIEWER
    );
    expect(first.changes).toEqual([{ kind: 'checks_passed', count: 1, required: false }]);
    const both = detail({ checkRuns: [check('test', 'success'), check('lint', 'success')] });
    expect(evaluatePullRequestWatch(first.next, both, [], VIEWER).changes).toEqual([]);
  });

  test('does not wake a watch saved before passed checks were recorded', () => {
    const green = detail({ checkRuns: [check('test', 'success', true)] });
    const told = watch({ headSha: 'aaaaaaaaaa', passed: true });
    const saved = evaluatePullRequestWatch(told, green, [], VIEWER);
    expect(saved.changes).toEqual([]);
    expect(saved.next.passedChecks).toEqual(['test']);
  });

  test('keeps remarks for a later pass when the conversation was not read whole', () => {
    const comments = [remark('reviewer', '2026-10-02T12:06:00Z')];
    const partial = evaluatePullRequestWatch(watch(), detail(), null, VIEWER);
    expect(partial.changes).toEqual([]);
    expect(partial.next.remarksThrough).toBe(STARTED);
    expect(evaluatePullRequestWatch(partial.next, detail(), comments, VIEWER).changes[0]?.kind).toBe(
      'remarks'
    );
  });

  test('reports a remark that shows up late with the same time as a reported one', () => {
    const first = remark('reviewer', '2026-10-02T12:06:00Z');
    const late = { ...remark('bot', '2026-10-02T12:06:00Z'), id: 'late' };
    const reported = evaluatePullRequestWatch(watch(), detail(), [first], VIEWER);
    const again = evaluatePullRequestWatch(reported.next, detail(), [first, late], VIEWER);
    expect(again.changes).toEqual([{ kind: 'remarks', remarks: [late] }]);
    expect(again.next.remarkIds).toEqual([first.id, 'late']);
  });

  test('reports edits after the watermark once and counts them toward the wake limit', () => {
    const old = remark('greptile[bot]', '2026-10-02T11:00:00Z');
    const watching = watch({
      headSha: 'aaaaaaaaaa',
      remarkIds: [old.id],
      wakes: PULL_REQUEST_WATCH_WAKE_LIMIT - 1,
    });
    expect(evaluatePullRequestWatch(watching, detail(), [old], VIEWER).changes).toEqual([]);
    const edited = { ...old, editedAt: '2026-10-02T12:06:00Z' };
    const report = evaluatePullRequestWatch(watching, detail(), [edited], VIEWER);
    expect(report.changes).toEqual([{ kind: 'remarks', remarks: [edited] }]);
    expect(report.next.remarksThrough).toBe(edited.editedAt);
    expect(report.next.remarkIds).toEqual([old.id]);
    expect(report.exhausted).toBe(true);
    expect(evaluatePullRequestWatch(report.next, detail(), [edited], VIEWER).changes).toEqual([]);
    const late = { ...edited, id: 'late' };
    expect(evaluatePullRequestWatch(report.next, detail(), [edited, late], VIEWER).changes).toEqual([
      { kind: 'remarks', remarks: [late] },
    ]);
  });

  test('does not treat a failed check read as a rerun', () => {
    const failed = detail({ checkRuns: [check('lint', 'failure')] });
    const reported = evaluatePullRequestWatch(watch(), failed, [], VIEWER);
    expect(reported.changes).toHaveLength(1);
    const unreadable = evaluatePullRequestWatch(reported.next, detail({ checkRuns: [] }), [], VIEWER);
    expect(evaluatePullRequestWatch(unreadable.next, failed, [], VIEWER).changes).toEqual([]);
    const older = evaluatePullRequestWatch(reported.next, detail({ checkRuns: undefined }), [], VIEWER);
    expect(older.next.failedChecks).toEqual(['lint']);
  });

  test('wakes for anyone but the reader; without a reader only remarks with no author are skipped', () => {
    const reply = remark('contributor', '2026-10-02T12:06:00Z');
    expect(evaluatePullRequestWatch(watch(), detail(), [reply], VIEWER).changes).toEqual([
      { kind: 'remarks', remarks: [reply] },
    ]);
    expect(evaluatePullRequestWatch(watch(), detail(), [reply], 'Contributor').changes).toEqual([]);
    const ghost = { ...reply, id: 'ghost', author: null };
    expect(evaluatePullRequestWatch(watch(), detail(), [ghost], null).changes).toEqual([]);
    expect(evaluatePullRequestWatch(watch(), detail(), [ghost], VIEWER).changes).toEqual([
      { kind: 'remarks', remarks: [ghost] },
    ]);
  });

  test('reports remarks from others once and never the reader’s own', () => {
    const comments = [
      remark('agent-user', '2026-10-02T12:05:00Z', 'Fixed in the latest push.'),
      remark('macroscope-app[bot]', '2026-10-02T12:06:00Z'),
      remark('reviewer', '2026-10-02T11:00:00Z', 'Older than the watch.'),
    ];
    const report = evaluatePullRequestWatch(watch(), detail(), comments, VIEWER);
    expect(report.changes).toEqual([{ kind: 'remarks', remarks: [comments[1] as PullRequestRemark] }]);
    expect(report.next.remarksThrough).toBe('2026-10-02T12:06:00Z');
    expect(evaluatePullRequestWatch(report.next, detail(), comments, VIEWER).changes).toEqual([]);
  });

  test('a new watch takes every remark as news, at the second boundary as well', () => {
    const report = evaluatePullRequestWatch(
      createPullRequestWatch(1),
      detail(),
      [remark('bot', '2020-01-01T00:00:00Z')],
      VIEWER
    );
    expect(report.changes).toHaveLength(1);
  });

  test('reports a conflict once, until the branch is clean again; unknown never clears it', () => {
    const conflicting = detail({ mergeable: false });
    const first = evaluatePullRequestWatch(watch(), conflicting, [], VIEWER);
    expect(first.changes).toEqual([{ kind: 'conflicting' }]);
    const recomputing = evaluatePullRequestWatch(first.next, detail({ mergeable: null }), [], VIEWER);
    expect(recomputing.next.conflicting).toBe(true);
    expect(evaluatePullRequestWatch(recomputing.next, conflicting, [], VIEWER).changes).toEqual([]);
    const clean = evaluatePullRequestWatch(first.next, detail(), [], VIEWER);
    expect(evaluatePullRequestWatch(clean.next, conflicting, [], VIEWER).changes).toEqual([
      { kind: 'conflicting' },
    ]);
  });

  test('does not spend the comment wake limit on check results', () => {
    const tired = watch({ headSha: 'aaaaaaaaaa', wakes: PULL_REQUEST_WATCH_WAKE_LIMIT - 1 });
    const result = evaluatePullRequestWatch(
      tired,
      detail({ checkRuns: [check('lint', 'failure')] }),
      [],
      VIEWER
    );
    expect(result.exhausted).toBe(false);
    expect(result.next.wakes).toBe(0);
  });

  test('stops after the wake limit unless the head moves', () => {
    const comments = [remark('reviewer', '2026-10-02T12:10:00Z')];
    const tired = watch({ headSha: 'aaaaaaaaaa', wakes: PULL_REQUEST_WATCH_WAKE_LIMIT - 1 });
    expect(evaluatePullRequestWatch(tired, detail(), comments, VIEWER).exhausted).toBe(true);
    const pushed = evaluatePullRequestWatch(tired, detail({ headSha: 'cccccccccc' }), comments, VIEWER);
    expect(pushed.exhausted).toBe(false);
    expect(pushed.next.wakes).toBe(1);
  });
});

describe('comparing watches and pull requests', () => {
  test('a watch is the same only when every field matches', () => {
    const base = watch();
    expect(isSamePullRequestWatch(base, { ...base })).toBe(true);
    for (const patch of [
      { startedAt: 2 },
      { headSha: 'x' },
      { failedChecks: ['a'] },
      { passed: true },
      { passedChecks: ['a'] },
      { remarksThrough: 'later' },
      { remarkIds: ['a'] },
      { conflicting: true },
      { wakes: 1 },
      { stopped: 'unreadable' as const },
      { ciAbsent: true },
    ]) {
      expect(isSamePullRequestWatch(base, { ...base, ...patch })).toBe(false);
    }
  });

  test('a pull request is the same apart from when it was read; nothing before means changed', () => {
    const read = detail();
    expect(isSamePullRequest(null, read)).toBe(false);
    expect(isSamePullRequest(read, { ...read, updatedAt: 99 })).toBe(true);
    expect(isSamePullRequest(read, { ...read, checks: 'failing' })).toBe(false);
    expect(isSamePullRequest(read, { ...read, mergeQueue: { state: 'queued', position: 1 } })).toBe(false);
    expect(
      isSamePullRequest(read, { ...read, changes: { additions: 3, deletions: 1, changedFiles: 2 } })
    ).toBe(false);
  });
});

describe('what a fix round is keyed to', () => {
  test('the failing checks by name, the unresolved threads and a conflict; comments alone key nothing', () => {
    const read = detail({
      checkRuns: [check('lint', 'failure'), check('test', 'success')],
      unresolvedThreads: ['t2', 't1'],
      mergeable: false,
    });
    expect(resolvePullRequestSignature(read, watch())).toBe('check:lint\nconflict\nthread:t1\nthread:t2');
    expect(resolvePullRequestSignature(detail(), watch())).toBeNull();
    expect(resolvePullRequestSignature(detail({ mergeable: null }), watch({ conflicting: true }))).toBe(
      'conflict'
    );
  });

  test('a pull request read without names keys nothing, since its totals cannot tell two failures apart', () => {
    expect(resolvePullRequestSignature(pullRequest({ checks: 'failing' }), watch())).toBeNull();
    expect(resolvePullRequestSignature(pullRequest({ unresolvedComments: 2 }), watch())).toBeNull();
    const halfNamed = detail({ checkRuns: [check('lint', 'failure')], unresolvedThreads: undefined });
    expect(resolvePullRequestSignature({ ...halfNamed, unresolvedComments: 1 }, watch())).toBeNull();
    expect(resolvePullRequestSignature(pullRequest({ mergeable: false }), watch())).toBe('conflict');
  });

  test('changes kept in the log list at most ten items with a total and short comment bodies', () => {
    const failed = Array.from({ length: 12 }, (_, index) => check(`c${index}`, 'failure'));
    const remarks = Array.from({ length: 11 }, (_, index) => ({
      ...remark(`r${index}`, STARTED, `<!-- hidden -->  ${'word '.repeat(80)}`),
    }));
    const [checks, comments, conflict] = trimWatchChanges([
      { kind: 'checks_failed', failed },
      { kind: 'remarks', remarks },
      { kind: 'conflicting' },
    ]);
    expect(checks).toMatchObject({ kind: 'checks_failed', total: 12 });
    expect(checks?.kind === 'checks_failed' && checks.failed).toHaveLength(10);
    expect(comments).toMatchObject({ kind: 'remarks', total: 11 });
    const body = comments?.kind === 'remarks' ? (comments.remarks[0]?.body ?? '') : '';
    expect(body.length).toBe(200);
    expect(body.startsWith('word word')).toBe(true);
    expect(body.endsWith('...')).toBe(true);
    expect(conflict).toEqual({ kind: 'conflicting' });
  });
});
