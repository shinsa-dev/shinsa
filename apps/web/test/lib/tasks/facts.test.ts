import { describe, expect, it } from 'bun:test';
import type { Task, Watchdog } from '@shinsa/core';
import { formatMoment } from '@/lib/format/time.ts';
import {
  describeDuplicateHint,
  describePullRequestFact,
  describeStarted,
  listDuplicates,
  listForkSources,
  listForks,
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
    expect(resolveReportFact(createShinsaState({}), createTask({ id: 't' }))).toBeNull();
  });

  it('names the source, who wrote it and when, and the watch that filed it, which opens its own page', () => {
    const reader = createTask({ id: 'reader', title: 'Read #support' });
    const task = createTask({
      id: 't',
      sourceReport: report,
      createdBy: { kind: 'intake', taskId: 'reader', runId: 'r', requestKey: report.link },
    });
    const state = createShinsaState({
      tasks: [reader, task],
      patch: { schedules: { 's-read': createSchedule({ id: 's-read', name: 'Support reports' }) } },
    });
    expect(resolveReportFact(state, task, NOW)).toEqual({
      label: 'Reported in composio-slack',
      byline: `Ana Ruiz · ${formatMoment(NOW - 2 * 60 * 60_000, NOW)}`,
      text: report.text,
      link: report.link,
      filedBy: {
        label: 'Filed by the automation',
        value: 'Support reports',
        watchId: 's-read',
        watchedTaskId: null,
      },
    });
  });

  it('keeps a time it cannot read as written, opens only web links, and survives a deleted automation', () => {
    const task = createTask({
      id: 't',
      sourceReport: { ...report, author: null, postedAt: 'yesterday', link: 'slack://channel?id=C1' },
    });
    expect(resolveReportFact(createShinsaState({ tasks: [task] }), task, NOW)).toMatchObject({
      byline: 'yesterday',
      link: null,
      filedBy: null,
    });
    const bare = { ...task, sourceReport: { ...report, author: null, postedAt: null, link: null } };
    expect(resolveReportFact(createShinsaState({ tasks: [bare] }), bare, NOW)).toMatchObject({
      byline: null,
      link: null,
    });
  });

  it('names the watchdog that filed it and opens the shipped task, and survives a stopped or missing one', () => {
    const shipped = createTask({
      id: 'shipped',
      handle: 'SW-2',
      watchdogs: [{ id: 'w1', title: 'Docs errors in Safari' } as Watchdog],
    });
    const fromWatchdog = { ...report, scheduleId: null, watchdogId: 'w1', server: 'maple' };
    const task = createTask({ id: 't', forkOf: 'shipped', sourceReport: fromWatchdog });
    const state = createShinsaState({ tasks: [shipped, task] });
    expect(resolveReportFact(state, task, NOW)).toMatchObject({
      label: 'Reported in maple',
      filedBy: {
        label: 'Filed by the watchdog',
        value: 'Docs errors in Safari',
        watchId: null,
        watchedTaskId: 'shipped',
      },
    });
    const gone = { ...task, sourceReport: { ...fromWatchdog, watchdogId: 'w2' } };
    expect(resolveReportFact(state, gone, NOW)?.filedBy).toBeNull();
    const orphan = { ...task, forkOf: null };
    expect(resolveReportFact(state, orphan, NOW)?.filedBy).toBeNull();
  });
});
