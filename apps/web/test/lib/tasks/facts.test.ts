import { describe, expect, it } from 'bun:test';
import type { Task, Watchdog } from '@shinsa/core';
import { formatMoment } from '@/lib/format/time.ts';
import {
  describeDuplicateHint,
  describePullRequestFact,
  describeStarted,
  listDuplicates,
  listForkSources,
  listForkSourcesBesides,
  listForks,
  resolveFiledByFact,
  resolveReportFact,
  selectDuplicateOriginal,
} from '@/lib/tasks/facts.ts';
import { createSchedule } from '../../support/schedules.ts';
import { createShinsaState, createTask, NOW } from '../../support/state.ts';

type PullRequest = NonNullable<Task['pullRequest']>;

function pullRequest(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    number: 42,
    url: 'https://github.com/acme/app/pull/42',
    state: 'open',
    checks: 'passing',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('describeStarted', () => {
  it('says when a task started', () => {
    const task = createTask({ id: 't', createdAt: NOW - 2 * 60 * 60_000 });
    expect(describeStarted(task, NOW)).toBe('Started 2h ago');
  });

  it('says added for a task that has not started because it waits on another', () => {
    const task = createTask({ id: 't', stage: 'waiting_on_tasks', waitsOn: ['base'], createdAt: NOW });
    expect(describeStarted(task, NOW)).toBe('Added just now');
    const fresh = { ...task, createdAt: Date.now() };
    expect(describeStarted(fresh)).toBe('Added just now');
  });

  it('keeps started for a task that waits to merge after another', () => {
    const task = createTask({ id: 't', stage: 'shipping', waitsOn: ['base'], createdAt: NOW - 5 * 60_000 });
    expect(describeStarted(task, NOW)).toBe('Started 5m ago');
  });
});

describe('describePullRequestFact', () => {
  it('adds nothing to a healthy open pull request', () => {
    expect(describePullRequestFact(pullRequest())).toEqual([]);
  });

  it('notes failing checks in red and unresolved comments in amber', () => {
    expect(describePullRequestFact(pullRequest({ checks: 'failing', unresolvedComments: 1 }))).toEqual([
      { text: 'checks failing', tone: 'red' },
      { text: '1 comment', tone: 'amber' },
    ]);
    expect(describePullRequestFact(pullRequest({ unresolvedComments: 3 }))).toEqual([
      { text: '3 comments', tone: 'amber' },
    ]);
  });

  it('notes a merged or closed pull request instead of its checks', () => {
    expect(describePullRequestFact(pullRequest({ state: 'merged', checks: 'failing' }))).toEqual([
      { text: 'merged', tone: 'neutral' },
    ]);
    expect(describePullRequestFact(pullRequest({ state: 'closed' }))).toEqual([
      { text: 'closed', tone: 'neutral' },
    ]);
  });
});

describe('forks', () => {
  it('lists the task a task was forked from, and the ones forked from it, oldest first', () => {
    const source = createTask({ id: 's' });
    const later = createTask({ id: 'b', forkOf: 's', createdAt: NOW });
    const earlier = createTask({ id: 'a', forkOf: 's', createdAt: NOW - 1 });
    const state = createShinsaState({ tasks: [source, later, earlier] });
    expect(listForkSources(state, later)).toEqual([source]);
    expect(listForkSources(state, source)).toEqual([]);
    expect(listForkSources(state, createTask({ id: 'x', forkOf: 'gone' }))).toEqual([]);
    expect(listForks(state, source).map((task) => task.id)).toEqual(['a', 'b']);
  });
});

describe('duplicates', () => {
  it('finds the task a duplicate repeats, if it is still known', () => {
    const original = createTask({ id: 'o' });
    const copy = createTask({ id: 'c', stage: 'cancelled', duplicate: { of: 'o', by: 'you', why: null } });
    const state = createShinsaState({ tasks: [original, copy] });
    expect(selectDuplicateOriginal(state, copy)).toBe(original);
    expect(selectDuplicateOriginal(state, original)).toBeNull();
    expect(
      selectDuplicateOriginal(state, { ...copy, duplicate: { of: 'gone', by: 'you', why: null } })
    ).toBeNull();
  });

  it('lists the tasks closed as duplicates of a task, oldest first', () => {
    const original = createTask({ id: 'o' });
    const later = createTask({ id: 'b', duplicate: { of: 'o', by: 'you', why: null }, createdAt: NOW - 1 });
    const earlier = createTask({
      id: 'a',
      duplicate: { of: 'o', by: 'shinsa', why: null },
      createdAt: NOW - 2,
    });
    const other = createTask({ id: 'x', duplicate: { of: 'b', by: 'you', why: null } });
    const state = createShinsaState({ tasks: [original, later, earlier, other] });
    expect(listDuplicates(state, original).map((task) => task.id)).toEqual(['a', 'b']);
    expect(listDuplicates(state, earlier)).toEqual([]);
  });

  it('says who closed it, and why when Shinsa did', () => {
    expect(describeDuplicateHint({ of: 'o', by: 'you', why: null })).toBe('You closed this as a duplicate.');
    expect(describeDuplicateHint({ of: 'o', by: 'you', why: null }, 'Kai')).toBe(
      'Kai closed this as a duplicate.'
    );
    expect(describeDuplicateHint({ of: 'o', by: 'shinsa', why: null }, 'Kai')).toBe(
      'Shinsa closed this as a duplicate.'
    );
    expect(describeDuplicateHint({ of: 'o', by: 'shinsa', why: null })).toBe(
      'Shinsa closed this as a duplicate.'
    );
    expect(describeDuplicateHint({ of: 'o', by: 'shinsa', why: 'Both add the export.' })).toBe(
      'Shinsa closed this as a duplicate: Both add the export.'
    );
  });
});

describe('resolveReportFact', () => {
  const report = {
    scheduleId: 's-read' as string | null,
    watchdogId: null as string | null,
    server: 'composio-slack',
    reportId: '1730120000.1234',
    link: 'https://acme.slack.com/archives/C1/p1730120000',
    author: 'Ana Ruiz',
    postedAt: new Date(NOW - 2 * 60 * 60_000).toISOString(),
    text: 'The docs ask me to sign in again on my phone.',
  };

  it('is absent on a task no automation filed', () => {
    expect(resolveReportFact(createTask({ id: 't' }))).toBeNull();
  });

  it('names the source, who wrote it and when', () => {
    const task = createTask({ id: 't', sourceReport: report });
    expect(resolveReportFact(task, NOW)).toEqual({
      label: 'Reported in composio-slack',
      byline: `Ana Ruiz · ${formatMoment(NOW - 2 * 60 * 60_000, NOW)}`,
      text: report.text,
      link: report.link,
    });
  });

  it('keeps a time it cannot read as written and opens only web links', () => {
    const task = createTask({
      id: 't',
      sourceReport: { ...report, author: null, postedAt: 'yesterday', link: 'slack://channel?id=C1' },
    });
    expect(resolveReportFact(task, NOW)).toMatchObject({ byline: 'yesterday', link: null });
    const bare = { ...task, sourceReport: { ...report, author: null, postedAt: null, link: null } };
    expect(resolveReportFact(bare, NOW)).toMatchObject({ byline: null, link: null });
  });
});

describe('resolveFiledByFact', () => {
  const filer = createTask({ id: 'filer', handle: 'LOC-122', title: 'Retry the export' });
  const report = {
    scheduleId: null as string | null,
    watchdogId: null as string | null,
    server: 'maple',
    reportId: 'err-7f3a',
    link: null,
    author: null,
    postedAt: null,
    text: 'TypeError on /docs/framework',
  };

  it('shows nothing for a task you filed yourself', () => {
    const task = createTask({ id: 't' });
    expect(resolveFiledByFact(createShinsaState({ tasks: [task] }), task)).toBeNull();
  });

  it('names the task whose agent filed it and opens that task', () => {
    const task = createTask({
      id: 't',
      createdBy: { kind: 'courier', taskId: 'filer', runId: 'r', requestKey: 'k' },
    });
    expect(resolveFiledByFact(createShinsaState({ tasks: [filer, task] }), task)).toEqual({
      icon: 'IconAgents',
      verb: 'Filed by',
      handle: 'LOC-122',
      name: 'Retry the export',
      hint: 'The agent of LOC-122 filed this task.',
      target: { kind: 'task', taskId: 'filer' },
    });
  });

  it('names the task whose plan it was split from, quoting its title when it has no handle', () => {
    const unnamed = { ...filer, handle: undefined };
    const task = createTask({
      id: 't',
      createdBy: { kind: 'split', taskId: 'filer', runId: 'r', requestKey: 'plan:1' },
    });
    expect(resolveFiledByFact(createShinsaState({ tasks: [unnamed, task] }), task)).toEqual({
      icon: 'IconSplit',
      verb: 'Split from',
      handle: null,
      name: 'Retry the export',
      hint: 'The agent of “Retry the export” split its plan into this task.',
      target: { kind: 'task', taskId: 'filer' },
    });
  });

  it('names the watchdog that filed it and opens the task it watches', () => {
    const shipped = createTask({
      id: 'shipped',
      handle: 'SW-2',
      watchdogs: [{ id: 'w1', title: 'Docs errors in Safari' } as Watchdog],
    });
    const task = createTask({
      id: 't',
      forkOf: 'shipped',
      sourceReport: { ...report, watchdogId: 'w1' },
      createdBy: { kind: 'watchdog', taskId: 'shipped', runId: 'r', requestKey: 'err-7f3a' },
    });
    const state = createShinsaState({ tasks: [shipped, task] });
    expect(resolveFiledByFact(state, task)).toEqual({
      icon: 'IconRadar',
      verb: 'Filed by',
      handle: null,
      name: '“Docs errors in Safari”',
      hint: 'The watchdog “Docs errors in Safari” on SW-2 filed this from a report in maple.',
      target: { kind: 'task', taskId: 'shipped' },
    });
    const stopped = { ...task, sourceReport: { ...report, watchdogId: 'w2' } };
    expect(resolveFiledByFact(state, stopped)).toBeNull();
    const unreported = { ...task, sourceReport: null };
    expect(resolveFiledByFact(state, unreported)).toBeNull();
  });

  it('names the automation that filed it from a report, or started it, and opens the automation', () => {
    const reader = createTask({ id: 'reader', title: 'Read #support' });
    const filed = createTask({
      id: 't',
      scheduleId: 's-read',
      sourceReport: { ...report, scheduleId: 's-read', server: 'composio-slack' },
      createdBy: { kind: 'intake', taskId: 'reader', runId: 'r', requestKey: 'k' },
    });
    const started = createTask({ id: 'u', scheduleId: 's-read' });
    const state = createShinsaState({
      tasks: [reader, filed, started],
      patch: { schedules: { 's-read': createSchedule({ id: 's-read', name: 'Support reports' }) } },
    });
    expect(resolveFiledByFact(state, filed)).toEqual({
      icon: 'IconCalendarClock',
      verb: 'Filed by',
      handle: null,
      name: '“Support reports”',
      hint: 'The automation “Support reports” filed this from a report in composio-slack.',
      target: { kind: 'automation', scheduleId: 's-read' },
    });
    expect(resolveFiledByFact(state, started)).toMatchObject({
      verb: 'Started by',
      hint: 'The automation “Support reports” started this task.',
    });
  });

  it('shows nothing once the task or the automation that filed it is gone', () => {
    const orphan = createTask({
      id: 't',
      createdBy: { kind: 'courier', taskId: 'gone', runId: 'r', requestKey: 'k' },
    });
    expect(resolveFiledByFact(createShinsaState({ tasks: [orphan] }), orphan)).toBeNull();
    const reader = createTask({ id: 'reader' });
    const unscheduled = createTask({
      id: 'u',
      scheduleId: 's-gone',
      sourceReport: { ...report, scheduleId: 's-gone' },
      createdBy: { kind: 'intake', taskId: 'reader', runId: 'r', requestKey: 'k' },
    });
    expect(resolveFiledByFact(createShinsaState({ tasks: [reader, unscheduled] }), unscheduled)).toBeNull();
  });
});

describe('listForkSourcesBesides', () => {
  it('leaves out the task it was forked from when that task also filed it', () => {
    const source = createTask({ id: 'source' });
    const task = createTask({ id: 't', forkOf: 'source' });
    const state = createShinsaState({ tasks: [source, task] });
    expect(listForkSourcesBesides(state, task, null)).toEqual([source]);
    const fromSource = { kind: 'task' as const, taskId: 'source' };
    const filedBy = { icon: 'IconAgents' as const, verb: 'Filed by', handle: null, name: '', hint: '' };
    expect(listForkSourcesBesides(state, task, { ...filedBy, target: fromSource })).toEqual([]);
    expect(
      listForkSourcesBesides(state, task, { ...filedBy, target: { kind: 'task', taskId: 'other' } })
    ).toEqual([source]);
    expect(
      listForkSourcesBesides(state, task, { ...filedBy, target: { kind: 'automation', scheduleId: 's' } })
    ).toEqual([source]);
  });
});
