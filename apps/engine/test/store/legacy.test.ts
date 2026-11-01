import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createState } from '@shinsa/core';
import { Engine } from '../../src/runtime/engine.ts';
import { EventLog } from '../../src/store/index.ts';
import {
  listLegacyBriefings,
  listLegacyEventTypes,
  listLegacyRewrites,
  type StoredEventRow,
} from '../../src/store/legacy.ts';
import { createTempDir } from '../helpers/index.ts';

const TASK = 'task-1';

function legacyRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    taskId: TASK,
    role: 'planner',
    status: 'queued',
    phaseIndex: null,
    prompt: 'Plan the task.',
    resume: false,
    provider: 'claude',
    model: 'opus',
    sessionId: null,
    startedAt: 1,
    endedAt: null,
    outcome: null,
    summary: null,
    ...overrides,
  };
}

function rowsOf(...events: Record<string, unknown>[]): StoredEventRow[] {
  return events.map((event, index) => ({
    seq: index + 1,
    type: String(event.type),
    payload: JSON.stringify(event),
  }));
}

function rewrite(...events: Record<string, unknown>[]) {
  return listLegacyRewrites(rowsOf(...events)).map((row) => ({
    seq: row.seq,
    type: row.type,
    event: JSON.parse(row.payload) as Record<string, unknown>,
  }));
}

function rewriteRun(run: Record<string, unknown>, ...before: Record<string, unknown>[]) {
  const rewritten = rewrite(...before, { type: 'run.started', run });
  return (rewritten.at(-1)?.event.run ?? null) as Record<string, unknown> | null;
}

const OLD_LOG: Record<string, unknown>[] = [
  {
    type: 'settings.changed',
    settings: { defaultProvider: 'claude', worktreesDirectory: '/tmp/worktrees', fastMode: false },
  },
  {
    type: 'task.created',
    taskId: TASK,
    repoId: null,
    priority: 'normal',
    specFirst: false,
    origin: null,
    auto: { review: false, merge: false },
    request: 'what projects do you know',
  },
  { type: 'task.staged', taskId: TASK, stage: 'planning', reason: 'Planning started' },
  { type: 'run.started', run: legacyRun() },
  { type: 'run.ended', runId: 'run-1', outcome: 'completed', summary: null },
  { type: 'worktree.created', taskId: TASK, path: '/tmp/worktree', branch: 'docs/projects' },
  { type: 'task.staged', taskId: TASK, stage: 'operating', reason: 'Operation started' },
  { type: 'run.started', run: legacyRun({ id: 'run-2', role: 'operator' }) },
  { type: 'run.ended', runId: 'run-2', outcome: 'completed', summary: null },
  { type: 'run.started', run: legacyRun({ id: 'run-3', role: 'answerer' }) },
  { type: 'task.answered', taskId: TASK, answer: 'Two projects.', runId: 'run-3' },
];

function writeLegacyLog(events: Record<string, unknown>[]) {
  const path = join(createTempDir(), 'shinsa.sqlite');
  new EventLog(path).close();
  const db = new Database(path);
  const insert = db.prepare('INSERT INTO events (seq, at, type, payload) VALUES (?, ?, ?, ?)');
  for (const row of rowsOf(...events)) insert.run(row.seq, 1000 + row.seq, row.type, row.payload);
  db.close();
  return path;
}

describe('rewriting events an older Shinsa wrote', () => {
  test('top-level planner, builder, fixer, shipper and operator runs become the task agent with a purpose', () => {
    const purposes = Object.fromEntries(
      ['planner', 'builder', 'fixer', 'shipper', 'operator'].map((role) => {
        const run = rewriteRun(legacyRun({ role }));
        return [role, `${run?.role}/${run?.purpose}`];
      })
    );
    expect(purposes).toEqual({
      planner: 'agent/plan',
      builder: 'agent/build',
      fixer: 'agent/fix',
      shipper: 'agent/fix',
      operator: 'agent/operate',
    });
  });

  test('an agent run without a purpose takes it from its stage, else from whether it builds a phase', () => {
    const staged = (stage: string) => ({ type: 'task.staged', taskId: TASK, stage, reason: '' });
    const agent = legacyRun({ role: 'agent' });
    expect(rewriteRun(agent, staged('fixing'))?.purpose).toBe('fix');
    expect(rewriteRun(agent, staged('checking'))?.purpose).toBe('plan');
    expect(rewriteRun(agent)?.purpose).toBe('plan');
    expect(rewriteRun({ ...agent, phaseIndex: 0 })?.purpose).toBe('build');
    expect(rewriteRun({ ...agent, taskId: 7 }, staged('fixing'))?.purpose).toBe('plan');
    expect(rewriteRun({ ...agent, purpose: 'operate' })).toBeNull();
    expect(rewriteRun({ ...agent, purpose: 'watch' }, staged('watching'))).toBeNull();
    expect(rewriteRun({ ...agent, purpose: 'intake' }, staged('watching'))).toBeNull();
    expect(rewriteRun({ ...agent, purpose: 'ship' })?.purpose).toBe('plan');
  });

  test('delegated helpers keep a helper role, and no helper or inquiry run keeps a purpose', () => {
    const delegation = { parentRunId: 'run-1', depth: 1 };
    expect(rewriteRun(legacyRun({ delegation }))).toBeNull();
    expect(rewriteRun(legacyRun({ role: 'fixer', purpose: 'fix', delegation }))).toEqual(
      legacyRun({ role: 'builder', delegation })
    );
    expect(rewriteRun(legacyRun({ role: 'reviewer', purpose: 'build', delegation }))).toEqual(
      legacyRun({ role: 'reviewer', delegation })
    );
    expect(rewriteRun(legacyRun({ role: 'researcher', purpose: 'plan' }))).toEqual(
      legacyRun({ role: 'researcher' })
    );
    expect(rewriteRun(legacyRun({ role: 'answerer' }))).toBeNull();
  });

  test('a run of a role Shinsa never had, or with no run at all, is left for the health check', () => {
    expect(rewriteRun(legacyRun({ role: 'wizard' }))).toBeNull();
    expect(rewriteRun(legacyRun({ role: 42 }))).toBeNull();
    expect(rewriteRun(legacyRun({ role: 'toString' }))).toBeNull();
    expect(rewrite({ type: 'run.started', run: null })).toEqual([]);
  });

  test('answers, plan-first flags, removed settings and worktrees without a mode take the current shape', () => {
    expect(rewrite(...OLD_LOG).map((row) => [row.seq, row.type])).toEqual([
      [1, 'settings.changed'],
      [2, 'task.created'],
      [4, 'run.started'],
      [6, 'worktree.created'],
      [8, 'run.started'],
      [11, 'task.delivered'],
    ]);
    const [settings, created, , worktree, , answered] = rewrite(...OLD_LOG).map((row) => row.event);
    expect(settings?.settings).toEqual({ defaultProvider: 'claude', fastMode: false });
    expect(created).toMatchObject({ planFirst: false });
    expect(created).not.toHaveProperty('specFirst');
    expect(worktree).toMatchObject({ workspace: 'worktrees' });
    expect(answered).toEqual({
      type: 'task.delivered',
      taskId: TASK,
      step: 'answer',
      body: 'Two projects.',
      runId: 'run-3',
    });
    expect(rewrite({ ...OLD_LOG[1], specFirst: true, planFirst: false })[0]?.event).toMatchObject({
      planFirst: false,
    });
    expect(rewrite({ type: 'task.answered', taskId: TASK, answer: 'Yes.' })[0]?.event.runId).toBeNull();
  });

  test('events already in the current shape, and rows it cannot read, are left alone', () => {
    const current = [
      { type: 'settings.changed', settings: null },
      { type: 'task.created', taskId: TASK, planFirst: true },
      { type: 'task.staged', taskId: 7, stage: 'planning' },
      { type: 'worktree.created', taskId: TASK, workspace: 'main_checkout' },
      { type: 'project.removed', projectId: 'p' },
    ];
    expect(rewrite(...current)).toEqual([]);
    const unreadable: StoredEventRow[] = [
      { seq: 1, type: 'task.answered', payload: 'not json' },
      { seq: 2, type: 'task.answered', payload: '[1]' },
      { seq: 3, type: 'task.answered', payload: '{"type":"task.delivered"}' },
    ];
    expect(listLegacyRewrites(unreadable)).toEqual([]);
  });
});

describe('a walkthrough’s testing as a plain list', () => {
  const walkthrough = { approach: 'a', flow: 'f', risks: [], testing: ['Resize it.'] };
  const guide = { automated: ['Resize it.'], manual: [] };

  test('becomes what the tests cover, in phase hand-overs, submitted reports and revisions', () => {
    expect(
      rewrite(
        { type: 'phase.completed', taskId: TASK, report: { index: 0, walkthrough } },
        { type: 'work.submitted', taskId: TASK, summary: 's', report: { headline: 'h', walkthrough } },
        { type: 'walkthrough.revised', taskId: TASK, walkthrough: { testing: ['Resize it.'] }, runId: 'r' }
      ).map((row) => row.event)
    ).toEqual([
      {
        type: 'phase.completed',
        taskId: TASK,
        report: { index: 0, walkthrough: { ...walkthrough, testing: guide } },
      },
      {
        type: 'work.submitted',
        taskId: TASK,
        summary: 's',
        report: { headline: 'h', walkthrough: { ...walkthrough, testing: guide } },
      },
      { type: 'walkthrough.revised', taskId: TASK, walkthrough: { testing: guide }, runId: 'r' },
    ]);
  });

  test('a report without a walkthrough, or one already in the new shape, is left alone', () => {
    expect(
      rewrite(
        { type: 'phase.completed', taskId: TASK, report: { index: 0, walkthrough: null } },
        { type: 'work.submitted', taskId: TASK, summary: 's', report: null },
        { type: 'walkthrough.revised', taskId: TASK, walkthrough: { flow: 'f' }, runId: 'r' },
        {
          type: 'phase.completed',
          taskId: TASK,
          report: { index: 0, walkthrough: { ...walkthrough, testing: guide } },
        }
      )
    ).toEqual([]);
  });

  test('is read from logs older than the walkthrough guide only', () => {
    const gitbutler = [
      'repo.registered',
      'repo.updated',
      'worktree.requested',
      'worktree.created',
      'gate.opened',
      'review.reported',
    ];
    expect(listLegacyEventTypes(0)).toContain('task.answered');
    const watchdogReads = ['task.created', 'watchdog.armed', 'watchdog.checked'];
    const later = [...watchdogReads, 'settings.changed', 'plan.proposed', 'task.shared', 'focus.changed'];
    expect(listLegacyEventTypes(2)).toEqual([
      'phase.completed',
      'work.submitted',
      'walkthrough.revised',
      'run.metered',
      'pull_request.watched',
      ...gitbutler,
      'schedule.written',
      ...later,
    ]);
    expect(listLegacyEventTypes(3)).toEqual([
      'run.metered',
      'pull_request.watched',
      ...gitbutler,
      'schedule.written',
      ...later,
    ]);
    expect(listLegacyEventTypes(4)).toEqual([
      'pull_request.watched',
      ...gitbutler,
      'schedule.written',
      ...later,
    ]);
    expect(listLegacyEventTypes(5)).toEqual([...gitbutler, 'schedule.written', ...later]);
    expect(listLegacyEventTypes(6)).toEqual(['review.reported', 'schedule.written', ...later]);
    expect(listLegacyEventTypes(7)).toEqual(['schedule.written', ...later]);
    expect(listLegacyEventTypes(8)).toEqual(later);
    expect(listLegacyEventTypes(9)).toEqual([
      'settings.changed',
      'plan.proposed',
      'task.shared',
      'focus.changed',
    ]);
    expect(listLegacyEventTypes(10)).toEqual([
      'settings.changed',
      'plan.proposed',
      'task.shared',
      'focus.changed',
    ]);
    expect(listLegacyEventTypes(11)).toEqual(['plan.proposed', 'task.shared', 'focus.changed']);
    expect(listLegacyEventTypes(12)).toEqual(['task.shared', 'focus.changed', 'plan.proposed']);
    expect(listLegacyEventTypes(13)).toEqual(['focus.changed', 'plan.proposed']);
    expect(listLegacyEventTypes(14)).toEqual(['plan.proposed']);
    expect(listLegacyEventTypes(15)).toEqual([]);
  });

  test('is rewritten on boot in a log already in the agent shape', () => {
    const path = writeLegacyLog([
      { type: 'phase.completed', taskId: TASK, report: { index: 0, walkthrough } },
    ]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 2');
    db.close();
    const log = new EventLog(path);
    expect(log.applyLegacyView()).toBe(1);
    expect(log.readEvents().events[0]).toMatchObject({ report: { walkthrough: { testing: guide } } });
    expect(log.replaceLegacyEvents()).toBe(1);
    expect(log.replaceLegacyEvents()).toBe(0);
    log.close();
    expect(readStoredLog(path).version).toBe(15);
  });
});

describe('A focus saved before teams', () => {
  test('gains no team, and a focus that names one is left alone', () => {
    expect(
      rewrite(
        { type: 'focus.changed', focus: { projectId: 'project-1', until: null } },
        { type: 'focus.changed', focus: { projectId: null, teamId: 'team-1', until: null } },
        { type: 'focus.changed', focus: null }
      ).map((row) => [row.seq, row.event.focus])
    ).toEqual([[1, { projectId: 'project-1', until: null, teamId: null }]]);
  });

  test('is rewritten on boot in a log of the share preset version', () => {
    const path = writeLegacyLog([{ type: 'focus.changed', focus: { projectId: null, until: null } }]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 13');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    log.close();
    expect(readStoredLog(path)).toMatchObject({
      version: 15,
      rows: [
        {
          payload: JSON.stringify({
            type: 'focus.changed',
            focus: { projectId: null, until: null, teamId: null },
          }),
        },
      ],
    });
  });
});

describe('Approve plans saved as a switch', () => {
  test('on becomes Large plans and off becomes When you ask; a mode is left alone', () => {
    expect(
      rewrite(
        { type: 'settings.changed', settings: { defaultProvider: 'claude', approvePlans: true } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude', approvePlans: false } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude', approvePlans: 'always' } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude' } }
      ).map((row) => [row.seq, row.event.settings])
    ).toEqual([
      [1, { defaultProvider: 'claude', approvePlans: 'large' }],
      [2, { defaultProvider: 'claude', approvePlans: 'when_asked' }],
    ]);
  });

  test('is rewritten on boot in a log of the watchdog reads’ version', () => {
    const path = writeLegacyLog([{ type: 'settings.changed', settings: { approvePlans: true } }]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 9');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    log.close();
    const stored = readStoredLog(path);
    expect(stored.version).toBe(15);
    expect(stored.rows).toEqual([
      {
        seq: 1,
        type: 'settings.changed',
        payload: JSON.stringify({ type: 'settings.changed', settings: { approvePlans: 'large' } }),
      },
    ]);
  });
});

describe('a revised plan’s change summary and feedback, which the reply replaced', () => {
  const document = { goal: 'Ship it.' };

  test('are dropped from every proposed plan; a plan without them is left alone', () => {
    expect(
      rewrite(
        { type: 'plan.proposed', taskId: TASK, body: 'b', document },
        {
          type: 'plan.proposed',
          taskId: TASK,
          body: 'b',
          document,
          changeSummary: 'Split it.',
          feedback: 'Two phases.',
        },
        { type: 'plan.proposed', taskId: TASK, body: 'b', document, changeSummary: null, feedback: null }
      )
    ).toEqual([
      { seq: 2, type: 'plan.proposed', event: { type: 'plan.proposed', taskId: TASK, body: 'b', document } },
      { seq: 3, type: 'plan.proposed', event: { type: 'plan.proposed', taskId: TASK, body: 'b', document } },
    ]);
  });

  test('are dropped on boot in a log of the compaction setting’s version', () => {
    const event = { type: 'plan.proposed', taskId: TASK, body: 'b', document, changeSummary: 'Split it.' };
    const path = writeLegacyLog([event]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 11');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    log.close();
    expect(readStoredLog(path)).toMatchObject({
      version: 15,
      rows: [{ payload: JSON.stringify({ type: 'plan.proposed', taskId: TASK, body: 'b', document }) }],
    });
  });
});

describe('a plan’s checks written as prose, before checks had a command', () => {
  const prose = { goal: 'Ship it.', phases: [], verification: ['Core: unit tests keep 100% coverage.'] };
  const current = {
    goal: 'Ship it.',
    phases: [],
    verification: [{ label: 'Tests', command: 'bun test test/a.test.ts', phases: [1] }],
  };

  test('drop the prose checks; a plan with current checks or no document is left alone', () => {
    expect(
      rewrite(
        { type: 'plan.proposed', taskId: TASK, body: 'b', document: prose },
        { type: 'plan.proposed', taskId: TASK, body: 'b', document: current },
        { type: 'plan.proposed', taskId: TASK, body: 'b', document: null }
      )
    ).toEqual([
      {
        seq: 1,
        type: 'plan.proposed',
        event: { type: 'plan.proposed', taskId: TASK, body: 'b', document: { ...prose, verification: [] } },
      },
    ]);
  });

  test('are rewritten on boot in a log of the team focus’s version and replay with no problems', () => {
    const path = writeLegacyLog([
      { type: 'plan.proposed', taskId: TASK, body: 'b', document: prose },
      { type: 'plan.proposed', taskId: TASK, body: 'b', document: current },
    ]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 14');
    db.close();
    const log = new EventLog(path);
    const engine = new Engine(log);
    expect(engine.problems).toEqual([]);
    log.close();
    expect(readStoredLog(path)).toMatchObject({
      version: 15,
      rows: [
        {
          payload: JSON.stringify({
            type: 'plan.proposed',
            taskId: TASK,
            body: 'b',
            document: { ...prose, verification: [] },
          }),
        },
        { payload: JSON.stringify({ type: 'plan.proposed', taskId: TASK, body: 'b', document: current }) },
      ],
    });
  });
});

describe('the compaction setting saved under its Eunoe names', () => {
  test('both Eunoe modes become the default and Claude Code’s becomes provider compaction; the rest is left alone', () => {
    expect(
      rewrite(
        { type: 'settings.changed', settings: { defaultProvider: 'claude', compaction: 'eunoe_compact' } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude', compaction: 'eunoe_default' } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude', compaction: 'claude' } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude', compaction: 'off' } },
        { type: 'settings.changed', settings: { defaultProvider: 'claude', compaction: 'compact' } }
      ).map((row) => [row.seq, row.event.settings])
    ).toEqual([
      [1, { defaultProvider: 'claude', compaction: 'fold' }],
      [2, { defaultProvider: 'claude', compaction: 'fold' }],
      [3, { defaultProvider: 'claude', compaction: 'provider' }],
    ]);
  });

  test('is rewritten on boot in a log of the plan approvals’ version', () => {
    const path = writeLegacyLog([{ type: 'settings.changed', settings: { compaction: 'eunoe_compact' } }]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 10');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    log.close();
    expect(readStoredLog(path)).toMatchObject({
      version: 15,
      rows: [{ payload: JSON.stringify({ type: 'settings.changed', settings: { compaction: 'fold' } }) }],
    });
  });
});

describe('the weekly usage a metered run recorded as one number', () => {
  const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.5 };

  test('is dropped, since it was the account’s movement and not the run’s share', () => {
    expect(
      rewrite(
        { type: 'run.metered', runId: 'r', usage, weeklyPercent: 77 },
        { type: 'run.metered', runId: 'r', usage }
      )
    ).toEqual([{ seq: 1, type: 'run.metered', event: { type: 'run.metered', runId: 'r', usage } }]);
  });

  test('is rewritten on boot in a log of the walkthrough guide’s version', () => {
    const path = writeLegacyLog([{ type: 'run.metered', runId: 'r', usage, weeklyPercent: 3 }]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 3');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    log.close();
    const stored = readStoredLog(path);
    expect(stored.version).toBe(15);
    expect(stored.rows).toEqual([
      { seq: 1, type: 'run.metered', payload: JSON.stringify({ type: 'run.metered', runId: 'r', usage }) },
    ]);
  });
});

describe('a pull request watch from before it knew whether a head has CI', () => {
  const watch = { startedAt: 1, headSha: 'abc', wakes: 0, stopped: null };

  test('gets ciAbsent false, so no head counts as without CI until Shinsa reads it again', () => {
    expect(
      rewrite(
        { type: 'pull_request.watched', taskId: TASK, watch, changes: [] },
        { type: 'pull_request.watched', taskId: TASK, watch: { ...watch, ciAbsent: true }, changes: [] },
        { type: 'pull_request.watched', taskId: TASK, watch: null, changes: [] }
      )
    ).toEqual([
      {
        seq: 1,
        type: 'pull_request.watched',
        event: {
          type: 'pull_request.watched',
          taskId: TASK,
          watch: { ...watch, ciAbsent: false },
          changes: [],
        },
      },
    ]);
  });
});

describe('a schedule from before it could read a data source', () => {
  const schedule = { id: 's1', name: 'Nightly', target: { kind: 'task', taskId: TASK } };

  test('reads none and has never finished a read; one that names its source and its last read keeps them', () => {
    const source = { projectId: 'p1', server: 'slack' };
    expect(
      rewrite(
        { type: 'schedule.written', schedule },
        { type: 'schedule.written', schedule: { ...schedule, source } },
        { type: 'schedule.written', schedule: { ...schedule, source, lastReadAt: 5 } }
      )
    ).toEqual([
      {
        seq: 1,
        type: 'schedule.written',
        event: { type: 'schedule.written', schedule: { ...schedule, source: null, lastReadAt: null } },
      },
      {
        seq: 2,
        type: 'schedule.written',
        event: { type: 'schedule.written', schedule: { ...schedule, source, lastReadAt: null } },
      },
    ]);
  });
});

describe('watchdogs from before they filed through file_report', () => {
  const report = {
    scheduleId: 's1',
    server: 'slack',
    reportId: 'r1',
    link: null,
    author: null,
    postedAt: null,
    text: 'Hi',
  };

  test('a watchdog keeps the task it filed as a list and links none, and a filed report says it came from no watchdog', () => {
    expect(
      rewrite(
        { type: 'watchdog.armed', taskId: TASK, watchdog: { id: 'w1', forkTaskId: null } },
        { type: 'watchdog.checked', taskId: TASK, watchdogId: 'w1', status: 'tripped', forkTaskId: 'fork' },
        { type: 'watchdog.checked', taskId: TASK, watchdogId: 'w1', status: 'watching', forkTaskId: null },
        { type: 'task.created', taskId: 'filed', sourceReport: report },
        { type: 'task.created', taskId: 'plain', specFirst: true }
      )
    ).toEqual([
      {
        seq: 1,
        type: 'watchdog.armed',
        event: {
          type: 'watchdog.armed',
          taskId: TASK,
          watchdog: { id: 'w1', forkTaskIds: [], linkedTaskIds: [] },
        },
      },
      {
        seq: 2,
        type: 'watchdog.checked',
        event: {
          type: 'watchdog.checked',
          taskId: TASK,
          watchdogId: 'w1',
          status: 'tripped',
          forkTaskIds: ['fork'],
        },
      },
      {
        seq: 3,
        type: 'watchdog.checked',
        event: {
          type: 'watchdog.checked',
          taskId: TASK,
          watchdogId: 'w1',
          status: 'watching',
          forkTaskIds: [],
        },
      },
      {
        seq: 4,
        type: 'task.created',
        event: { type: 'task.created', taskId: 'filed', sourceReport: { ...report, watchdogId: null } },
      },
      { seq: 5, type: 'task.created', event: { type: 'task.created', taskId: 'plain', planFirst: true } },
    ]);
  });

  test('events already in the new shape, or with no watchdog, are left alone', () => {
    expect(
      rewrite(
        { type: 'watchdog.armed', taskId: TASK, watchdog: null },
        {
          type: 'watchdog.armed',
          taskId: TASK,
          watchdog: { id: 'w2', forkTaskIds: [], linkedTaskIds: [] },
        },
        { type: 'watchdog.checked', taskId: TASK, watchdogId: 'w1', forkTaskIds: ['fork'] },
        { type: 'task.created', taskId: 'filed', sourceReport: { ...report, watchdogId: 'w1' } },
        { type: 'task.created', taskId: 'plain', planFirst: false }
      )
    ).toEqual([]);
  });
});

describe('review findings from before the three levels', () => {
  const finding = (severity: unknown) => ({ severity, file: 'a.ts', line: 1, message: 'Look.' });

  test('a suggestion becomes optional; blocking findings and other events stay as they are', () => {
    expect(
      rewrite(
        {
          type: 'review.reported',
          taskId: TASK,
          summary: null,
          findings: [finding('blocking'), finding('suggestion'), 'broken'],
        },
        { type: 'review.reported', taskId: TASK, summary: null, findings: [finding('should_fix')] },
        { type: 'review.reported', taskId: TASK, summary: null }
      )
    ).toEqual([
      {
        seq: 1,
        type: 'review.reported',
        event: {
          type: 'review.reported',
          taskId: TASK,
          summary: null,
          findings: [finding('blocking'), finding('optional'), 'broken'],
        },
      },
    ]);
  });
});

describe('GitButler, which Shinsa no longer has', () => {
  const repo = { id: 'repo-1', name: 'app', path: '/code/app', checkCommands: [], workspace: 'gitbutler' };
  const gate = { id: 'gate-1', taskId: TASK, type: 'failure', status: 'open', cause: 'workspace_update' };

  test('a repository that chose it works in worktrees; a task working in it keeps the checkout', () => {
    expect(
      rewrite(
        { type: 'repo.registered', repo },
        { type: 'repo.updated', repo },
        { type: 'worktree.requested', taskId: TASK, workspace: 'gitbutler' },
        {
          type: 'worktree.created',
          taskId: TASK,
          path: '/code/app',
          branch: 'fix/a',
          workspace: 'gitbutler',
        },
        { type: 'gate.opened', gate }
      ).map((row) => row.event)
    ).toEqual([
      { type: 'repo.registered', repo: { ...repo, workspace: 'worktrees' } },
      { type: 'repo.updated', repo: { ...repo, workspace: 'worktrees' } },
      { type: 'worktree.requested', taskId: TASK, workspace: 'worktrees' },
      {
        type: 'worktree.created',
        taskId: TASK,
        path: '/code/app',
        branch: 'fix/a',
        workspace: 'main_checkout',
      },
      { type: 'gate.opened', gate: { id: 'gate-1', taskId: TASK, type: 'failure', status: 'open' } },
    ]);
  });

  test('other workspaces, gates and malformed events are left alone', () => {
    expect(
      rewrite(
        { type: 'repo.updated', repo: { ...repo, workspace: 'main_checkout' } },
        { type: 'repo.updated', repo: null },
        { type: 'worktree.requested', taskId: TASK, workspace: 'main_checkout' },
        { type: 'gate.opened', gate: { ...gate, cause: 'push_hook' } },
        { type: 'gate.opened', gate: 'broken' }
      )
    ).toEqual([]);
  });

  test('an old log replays on boot with no problems, and its workspace update effect settles unrun', () => {
    const path = writeLegacyLog([
      { type: 'repo.registered', repo },
      { type: 'worktree.requested', taskId: TASK, workspace: 'gitbutler' },
      { type: 'task.stacked', taskId: TASK, onTaskId: 'task-2', branch: 'fix/b' },
      { type: 'task.conflict_held', taskId: TASK, branch: 'fix/a' },
      { type: 'task.unstacked', taskId: TASK, fromTaskId: 'task-2' },
      { type: 'gate.opened', gate },
    ]);
    const db = new Database(path);
    db.run(
      `INSERT INTO effects (key, lane, kind, payload, status, available_at, created_at)
       VALUES ('workspace.update:task-1:6', 'task:task-1', 'workspace.update', ?, 'pending', 1, 1)`,
      [JSON.stringify({ kind: 'workspace.update', taskId: TASK, guidance: null })]
    );
    db.close();
    const log = new EventLog(path);
    const engine = new Engine(log);
    expect(engine.problems).toEqual([]);
    expect(engine.state.repos['repo-1']?.workspace).toBe('worktrees');
    expect(engine.state.gates['gate-1']?.cause).toBeUndefined();
    expect(log.reconcileAfterRestart(2)).toMatchObject({ failed: 1, requeued: 0 });
    expect(log.listEffectStatuses()).toEqual([
      { key: 'workspace.update:task-1:6', kind: 'workspace.update', status: 'failed', attempts: 0 },
    ]);
    expect(log.claimEffects(3)).toEqual([]);
    log.close();
  });
});

describe('the event log on boot', () => {
  test('rewrites an old log once, drops the snapshot it stood on and replays with no problems', () => {
    const path = writeLegacyLog(OLD_LOG);
    const log = new EventLog(path);
    const stale = { ...createState(), seq: 11 };
    log.writeSnapshot({ seq: 11, version: 'v', payload: JSON.stringify(stale), problems: [] }, 1);
    expect(log.selectSnapshot('v')).toMatchObject({ ok: true, seq: 11 });
    const engine = new Engine(log);
    expect(engine.problems).toEqual([]);
    expect(log.selectSnapshot('v')).toBeNull();
    expect(
      Object.values(engine.state.runs).map((run) => `${run.id}:${run.role}/${run.purpose ?? '-'}`)
    ).toEqual(['run-1:agent/plan', 'run-2:agent/operate', 'run-3:answerer/-']);
    expect(engine.state.tasks[TASK]?.result).toMatchObject({ step: 'answer', body: 'Two projects.' });
    expect(log.replaceLegacyEvents()).toBe(0);
    log.close();
  });

  test('runs once per log, and keeps the snapshot of a log with nothing to rewrite', () => {
    const path = writeLegacyLog([{ type: 'project.removed', projectId: 'p' }]);
    const log = new EventLog(path);
    log.writeSnapshot(
      { seq: 1, version: 'v', payload: JSON.stringify({ ...createState(), seq: 1 }), problems: [] },
      1
    );
    expect(log.replaceLegacyEvents()).toBe(0);
    expect(log.selectSnapshot('v')).toMatchObject({ ok: true, seq: 1 });
    log.close();
    const db = new Database(path);
    db.run('INSERT INTO events (seq, at, type, payload) VALUES (2, 2, ?, ?)', [
      'task.answered',
      JSON.stringify({ type: 'task.answered', taskId: TASK, answer: 'Late.', runId: null }),
    ]);
    db.close();
    const reopened = new EventLog(path);
    expect(reopened.replaceLegacyEvents()).toBe(0);
    reopened.close();
  });
});

function readStoredLog(path: string) {
  const db = new Database(path);
  const rows = db.query('SELECT seq, type, payload FROM events ORDER BY seq').all();
  const version = db.query<{ user_version: number }, []>('PRAGMA user_version').get()?.user_version;
  const briefings = db.query('SELECT * FROM briefings').all();
  const snapshots = db.query('SELECT seq FROM snapshots').all();
  db.close();
  return { rows, version, briefings, snapshots };
}

describe('inspecting an old log', () => {
  const guide = { now: null, next: [], running: 'No agent is working right now.', note: null };

  test('reads it in the new shape with no problems, and never writes it', () => {
    const path = writeLegacyLog([
      ...OLD_LOG,
      { type: 'briefing.written', projectId: null, text: 'Guide.', briefing: guide },
    ]);
    const seeded = new EventLog(path);
    seeded.writeBriefing('work', { text: 'Kept.', at: 1, briefing: null });
    seeded.writeBriefing(null, { text: 'Replaced.', at: 1, briefing: null });
    seeded.writeSnapshot({ seq: 11, version: 'v', payload: JSON.stringify(createState()), problems: [] }, 1);
    seeded.close();
    const before = readStoredLog(path);
    const log = new EventLog(path);
    const inspected = new Engine(log, { readOnly: true, stateVersion: 'v' });
    expect(inspected.problems).toEqual([]);
    expect(inspected.state.seq).toBe(12);
    expect(
      Object.values(inspected.state.runs).map((run) => `${run.id}:${run.role}/${run.purpose ?? '-'}`)
    ).toEqual(['run-1:agent/plan', 'run-2:agent/operate', 'run-3:answerer/-']);
    expect(inspected.state.tasks[TASK]?.result).toMatchObject({ step: 'answer', body: 'Two projects.' });
    expect(inspected.state.briefings['*']).toEqual({ text: 'Guide.', at: 1012, briefing: guide });
    expect(inspected.state.briefings.work).toMatchObject({ text: 'Kept.' });
    expect(log.readEvents().events.some((event) => (event.type as string) === 'briefing.written')).toBe(
      false
    );
    expect(log.listEventsBetween(1, 1)[0]).toMatchObject({ settings: { fastMode: false } });
    expect(log.selectSnapshot('v')).toBeNull();
    log.close();
    expect(readStoredLog(path)).toEqual(before);
  });

  test('a log already in the new shape reads as it is', () => {
    const path = writeLegacyLog([{ type: 'project.removed', projectId: 'p' }]);
    const log = new EventLog(path);
    expect(log.applyLegacyView()).toBe(0);
    expect(log.replaceLegacyEvents()).toBe(0);
    expect(log.applyLegacyView()).toBe(0);
    log.close();
  });

  test('a log in the agent shape with briefings only hides them', () => {
    const path = writeLegacyLog([
      { type: 'task.answered', taskId: TASK, answer: 'Left as it was.', runId: null },
      { type: 'briefing.written', projectId: 'work', text: 'Read.' },
    ]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 1');
    db.close();
    const log = new EventLog(path);
    expect(log.applyLegacyView()).toBe(1);
    expect(log.readEvents().events.map((event) => event.type as string)).toEqual(['task.answered']);
    expect(log.listBriefings()).toEqual([
      { projectId: 'work', stored: { text: 'Read.', at: 1002, briefing: null } },
    ]);
    log.close();
  });
});

describe('moving briefings out of the event log', () => {
  const guide = { now: null, next: [], running: 'No agent is working right now.', note: null };
  const briefing = (seq: number, event: Record<string, unknown>) => ({
    seq,
    at: 1000 + seq,
    payload: JSON.stringify({ type: 'briefing.written', ...event }),
  });

  test('keeps the newest guide per project, stamped with its row’s time', () => {
    expect(
      listLegacyBriefings([
        briefing(1, { projectId: null, text: 'Old.', briefing: guide }),
        briefing(2, { projectId: 'work', text: 'Plain text only.' }),
        briefing(3, { text: 'No project means the whole queue.', briefing: guide }),
        briefing(4, { projectId: 'work', text: 42 }),
        { seq: 5, at: 1005, payload: 'not json' },
      ])
    ).toEqual([
      { projectId: null, stored: { text: 'No project means the whole queue.', at: 1003, briefing: guide } },
      { projectId: 'work', stored: { text: 'Plain text only.', at: 1002, briefing: null } },
    ]);
  });

  test('a log with briefings moves the newest into their own table once, with their receipts and the snapshot', () => {
    const path = writeLegacyLog([
      ...OLD_LOG,
      { type: 'briefing.written', projectId: null, text: 'First.' },
      { type: 'briefing.written', projectId: null, text: 'Second.', briefing: guide },
    ]);
    const db = new Database(path);
    db.run(
      "INSERT INTO receipts (id, type, target, fingerprint, status, code, error, first_seq, last_seq, at) VALUES ('briefing:*:3', 'briefing.write', 'projectId:*', 'f', 'accepted', NULL, NULL, 13, 13, 1)"
    );
    db.close();
    const log = new EventLog(path);
    log.writeSnapshot(
      { seq: 11, version: 'v', payload: JSON.stringify({ ...createState(), seq: 11 }), problems: [] },
      1
    );
    const engine = new Engine(log);
    expect(engine.problems).toEqual([]);
    expect(engine.state.seq).toBe(13);
    expect(engine.state.briefings['*']).toEqual({ text: 'Second.', at: 1013, briefing: guide });
    expect(log.readEvents().events.some((event) => (event.type as string) === 'briefing.written')).toBe(
      false
    );
    expect(log.selectReceipt('briefing:*:3')).toBeNull();
    expect(log.selectSnapshot('v')).toBeNull();
    expect(log.replaceLegacyEvents()).toBe(0);
    log.close();
    const reopened = new EventLog(path);
    const snapshotted = new Engine(reopened, { stateVersion: 'v2' });
    expect(snapshotted.state.seq).toBe(13);
    expect(snapshotted.writeSnapshot()).toBe(true);
    expect(reopened.selectSnapshot('v2')).toMatchObject({ ok: true, seq: 13 });
    reopened.close();
  });

  test('a log already in the agent shape only has its briefings moved', () => {
    const path = writeLegacyLog([
      { type: 'task.answered', taskId: TASK, answer: 'Left as it was.', runId: null },
      { type: 'briefing.written', projectId: 'work', text: 'Moved.' },
    ]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 1');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    expect(log.readEvents().events.map((event) => event.type as string)).toEqual(['task.answered']);
    expect(log.listBriefings()).toEqual([
      { projectId: 'work', stored: { text: 'Moved.', at: 1002, briefing: null } },
    ]);
    log.close();
  });
});

describe('shares made before presets', () => {
  test('are rewritten on boot as Standard shares, and a share with a preset is left as it is', () => {
    const shared = { type: 'task.shared', taskId: TASK, limit: 'day', endsAt: 5 };
    const status = { ...shared, preset: 'status' };
    const path = writeLegacyLog([shared, status]);
    const db = new Database(path);
    db.run('PRAGMA user_version = 11');
    db.close();
    const log = new EventLog(path);
    expect(log.replaceLegacyEvents()).toBe(1);
    log.close();
    expect(readStoredLog(path)).toMatchObject({
      version: 15,
      rows: [
        { payload: JSON.stringify({ ...shared, preset: 'standard' }) },
        { payload: JSON.stringify(status) },
      ],
    });
  });
});
