import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Schedule } from '@shinsa/core';
import {
  ANY_REPOSITORY,
  type AutomationDraft,
  createAutomationDraft,
  describeAutomationSaved,
  describeAutomationTasks,
  describeReadsEmpty,
  listAutomationFacts,
  listAutomationGates,
  listAutomationReads,
  listAutomationTasks,
  listRepoItems,
  listSourceItems,
  resolveAutomationCommand,
  selectWatchOfHome,
  selectWatchSource,
  validateAutomationDraft,
  writeAutomation,
} from '@/lib/automations.ts';
import { resolveAutomationPath } from '@/router.ts';
import { createSchedule } from '../support/schedules.ts';
import {
  holdAcks,
  listSentCommands,
  releaseAcks,
  startFakeServer,
  stopFakeServer,
} from '../support/server.ts';
import {
  createGate,
  createProject,
  createRepo,
  createRun,
  createShinsaState,
  createTask,
  NOW,
} from '../support/state.ts';

const SLACK = {
  server: 'slack',
  data: 'The #feedback channel',
  repoIds: [],
  addedBy: 'you' as const,
  addedAt: 0,
};

const PROJECT = createProject({ id: 'p1', name: 'Superwall', watchSources: [SLACK] });

function draft(overrides: Partial<AutomationDraft> = {}): AutomationDraft {
  return { ...createAutomationDraft(), text: 'Bug reports.', ...overrides };
}

describe('the new automation form', () => {
  it('starts as a watch every hour, and lists the integrations projects use and the repositories', () => {
    expect(createAutomationDraft()).toMatchObject({
      kind: 'watch',
      everyMinutes: '60',
      repoId: ANY_REPOSITORY,
    });
    const state = createShinsaState({
      projects: [PROJECT, createProject({ id: 'p2' })],
      repos: [createRepo({ id: 'r2', name: 'web' }), createRepo({ id: 'r1', name: 'app' })],
    });
    expect(listSourceItems(state)).toEqual([
      { value: 'p1\u0000slack', label: 'slack', hint: 'Superwall · The #feedback channel' },
    ]);
    expect(listRepoItems(state).map((item) => item.label)).toEqual([
      'Shinsa picks the repository',
      'app',
      'web',
    ]);
  });

  it('asks for what it does, a sane interval and, for a watch, its integration', () => {
    expect(validateAutomationDraft(draft())).toEqual({ source: 'Pick the integration it reads.' });
    expect(validateAutomationDraft(draft({ kind: 'schedule', text: ' ', everyMinutes: '0' }))).toEqual({
      text: 'Say what it should do.',
      everyMinutes: 'Run it every 1 to 10080 minutes.',
    });
    expect(validateAutomationDraft(draft({ kind: 'trigger', everyMinutes: 'x' }))).toEqual({});
  });

  it('writes a watch as a schedule that reads its integration, and the others as new tasks', () => {
    expect(
      resolveAutomationCommand(draft({ name: ' Feedback ', source: 'p1\u0000slack' }), 'Europe/Berlin')
    ).toEqual({
      type: 'schedule.write',
      scheduleId: null,
      name: 'Feedback',
      text: 'Bug reports.',
      trigger: { kind: 'interval', everyMinutes: 60 },
      target: null,
      source: { projectId: 'p1', server: 'slack' },
      enabled: null,
      maxRuns: null,
      timeZone: 'Europe/Berlin',
    });
    expect(
      resolveAutomationCommand(draft({ kind: 'schedule', everyMinutes: '30', repoId: 'r1' }), 'UTC')
    ).toMatchObject({
      name: null,
      trigger: { kind: 'interval', everyMinutes: 30 },
      target: { kind: 'new_task', repoId: 'r1', priority: 'normal', mode: 'build' },
      source: null,
    });
    expect(resolveAutomationCommand(draft({ kind: 'trigger', everyMinutes: 'x' }), 'UTC')).toMatchObject({
      trigger: { kind: 'webhook', signature: null, replayKey: null },
      target: { kind: 'new_task', repoId: null },
    });
    expect(
      resolveAutomationCommand(draft({ kind: 'watch', everyMinutes: 'x', source: '' }), 'UTC')
    ).toMatchObject({
      trigger: { kind: 'interval', everyMinutes: 60 },
      source: { projectId: '', server: '' },
    });
    expect(describeAutomationSaved({ kind: 'trigger' })).toBe(
      'Created the trigger. Copy its webhook URL from its menu.'
    );
  });
});

describe('sending a new automation', () => {
  beforeEach(() => {
    startFakeServer();
  });

  afterEach(() => {
    stopFakeServer();
  });

  it('sends the command, and hands back the server’s refusal', async () => {
    expect(await writeAutomation(draft({ source: 'p1\u0000slack' }))).toBeNull();
    expect(listSentCommands()).toMatchObject([{ type: 'schedule.write', source: { server: 'slack' } }]);
    holdAcks();
    const refused = writeAutomation(draft({ source: 'p1\u0000gone' }));
    await Promise.resolve();
    releaseAcks({ code: 'source_not_found', message: 'The project does not use gone.' });
    expect(await refused).toBe('The project does not use gone.');
  });
});

describe('a watch’s page', () => {
  const watch = createSchedule({
    id: 's1',
    name: 'Feedback',
    source: { projectId: 'p1', server: 'slack' },
    target: { kind: 'task', taskId: 'home' },
    runs: [
      {
        at: NOW - 3_000,
        outcome: 'skipped',
        taskId: null,
        deliveryId: null,
        detail: 'The task was at work.',
      },
      { at: NOW - 2_000, outcome: 'failed', taskId: null, deliveryId: null, detail: 'It broke.' },
      { at: NOW - 1_000, outcome: 'sent', taskId: 'home', deliveryId: null, detail: null },
    ],
  });
  const filed = createTask({
    id: 'f1',
    createdAt: NOW,
    sourceReport: {
      scheduleId: 's1',
      server: 'slack',
      reportId: '1',
      link: null,
      author: null,
      postedAt: null,
      text: 'Broken.',
    },
    createdBy: { kind: 'intake', taskId: 'home', runId: 'read-1', requestKey: '1' },
  });
  const state = createShinsaState({
    projects: [PROJECT],
    tasks: [
      createTask({ id: 'home', watchHome: true }),
      { ...filed, id: 'f0', createdAt: NOW - 10_000, createdBy: null },
      filed,
      createTask({ id: 'other' }),
    ],
    runs: [
      createRun({
        id: 'read-1',
        taskId: 'home',
        purpose: 'intake',
        startedAt: NOW - 5_000,
        endedAt: NOW - 4_500,
        outcome: 'completed',
        summary: 'Read 4 messages; filed 1.',
      }),
      createRun({ id: 'read-2', taskId: 'home', purpose: 'intake', startedAt: NOW - 4_000, endedAt: null }),
      createRun({
        id: 'read-3',
        taskId: 'home',
        purpose: 'intake',
        startedAt: NOW - 3_500,
        endedAt: NOW - 3_400,
        outcome: 'failed',
        summary: null,
      }),
      createRun({ id: 'other-run', taskId: 'other', purpose: 'build', startedAt: NOW }),
    ],
    patch: { schedules: { s1: watch } },
  });

  it('opens from its home task, and lays out its type, state, integration, project and times as facts', () => {
    expect(resolveAutomationPath('s 1')).toBe('/automations/s%201');
    expect(selectWatchOfHome(state, 'home')?.id).toBe('s1');
    expect(selectWatchOfHome(state, 'other')).toBeNull();
    expect(selectWatchSource(state, watch)).toBe(SLACK);
    expect(selectWatchSource(state, createSchedule({ id: 'plain' }))).toBeNull();
    expect(
      listAutomationFacts(state, watch).map((fact) => [fact.key, fact.label, fact.tone, fact.at])
    ).toEqual([
      ['type', 'Watch', 'neutral', null],
      ['state', 'On', 'green', null],
      ['source', 'slack', 'neutral', null],
      ['project', 'Superwall', 'neutral', null],
      ['when', 'Every hour', 'neutral', null],
      ['next', 'Next run', 'neutral', NOW + 60 * 60_000],
      ['last', 'Last read', 'neutral', NOW - 1_000],
      ['filed', '2 tasks filed', 'neutral', null],
    ]);
    expect(listAutomationFacts(state, watch).find((fact) => fact.key === 'source')?.hint).toBe(
      'The #feedback channel'
    );
  });

  it('says how a plain schedule stands: paused, finished, stopped or failing, in its project', () => {
    const repo = createRepo({ id: 'r1', projectId: 'p1' });
    const plain = createShinsaState({ projects: [PROJECT], repos: [repo] });
    const facts = (schedule: Partial<Schedule>) =>
      listAutomationFacts(plain, createSchedule({ id: 'x', ...schedule })).map((fact) => fact.label);
    expect(facts({ enabled: false })).toEqual(['Schedule', 'Paused', 'Every hour']);
    expect(
      facts({
        stopped: 'finished',
        target: { kind: 'new_task', repoId: 'r1', priority: 'normal', mode: 'build' },
      })
    ).toEqual(['Schedule', 'Finished', 'Superwall', 'Every hour']);
    expect(facts({ stopped: 'target_gone', target: { kind: 'task', taskId: 'gone' } })).toEqual([
      'Schedule',
      'Stopped',
      'Every hour',
    ]);
    expect(
      facts({
        trigger: { kind: 'webhook', signature: null, replayKey: null },
        nextRunAt: null,
        runs: [{ at: NOW, outcome: 'failed', taskId: null, deliveryId: null, detail: 'Bad.' }],
      })
    ).toEqual(['Trigger', 'Last run failed', 'When its webhook is called']);
    expect(
      facts({ runs: [{ at: NOW, outcome: 'sent', taskId: null, deliveryId: null, detail: null }] })
    ).toEqual(['Schedule', 'On', 'Every hour', 'Next run', 'Last run']);
  });

  it('lists the tasks it filed, and every run newest first as activity', () => {
    expect(listAutomationTasks(state, watch).map((task) => task.id)).toEqual(['f1', 'f0']);
    expect(describeAutomationTasks(watch)).toEqual({ title: 'Tasks it filed', empty: 'Nothing filed yet.' });
    expect(
      listAutomationReads(state, watch).map((read) => [
        read.label,
        read.icon,
        read.tone,
        read.summary,
        read.filed.length,
      ])
    ).toEqual([
      ['Failed', 'IconExclamationCircle', 'red', 'It broke.', 0],
      ['Skipped', 'IconClockSnooze', 'neutral', 'The task was at work.', 0],
      ['Did not finish', 'IconExclamationTriangle', 'amber', null, 0],
      ['Reading slack', 'IconEyeOpen', 'blue', null, 0],
      ['Read slack, filed 1 task', 'IconListBullets', 'green', 'Read 4 messages; filed 1.', 1],
    ]);
    const quiet = {
      ...state,
      runs: {
        r: createRun({
          id: 'r',
          taskId: 'home',
          purpose: 'intake',
          startedAt: NOW,
          endedAt: NOW,
          outcome: 'completed',
          summary: 'Nothing new.',
        }),
      },
    };
    expect(listAutomationReads(quiet, { ...watch, runs: [] }).map((read) => read.label)).toEqual([
      'Read slack, filed nothing',
    ]);
  });

  it('shows what a plain schedule started or messaged, and the tasks it started', () => {
    const started = createTask({ id: 't1', scheduleId: 'n' });
    const sent = { at: NOW, outcome: 'sent' as const, taskId: 't1', deliveryId: null, detail: null };
    const plain = createShinsaState({
      tasks: [started, createTask({ id: 'home2', scheduleId: 'n', watchHome: true })],
    });
    const starter = createSchedule({ id: 'n', runs: [sent, { ...sent, at: NOW - 1, taskId: 'gone' }] });
    expect(listAutomationTasks(plain, starter).map((task) => task.id)).toEqual(['t1']);
    expect(describeAutomationTasks(starter)).toEqual({ title: 'Tasks it started', empty: 'No task yet.' });
    expect(listAutomationReads(plain, starter).map((read) => [read.label, read.filed.length])).toEqual([
      ['Started a task', 1],
      ['Started a task', 0],
    ]);
    const messenger = createSchedule({ id: 'm', target: { kind: 'task', taskId: 't1' }, runs: [sent] });
    expect(listAutomationReads(plain, messenger).map((read) => read.label)).toEqual(['Messaged its task']);
  });

  it('says why there is nothing yet', () => {
    expect(describeReadsEmpty(watch)).toBe('No read yet. The first one starts at its next run.');
    expect(describeReadsEmpty({ ...watch, enabled: false })).toBe('Nothing yet, and it is paused.');
    expect(describeReadsEmpty(createSchedule({ id: 'n' }))).toBe(
      'Nothing yet. It first runs at its next run.'
    );
  });
});

describe('the decisions a watch waits on', () => {
  const watch = createSchedule({
    id: 'w',
    source: { projectId: 'p1', server: 'slack' },
    target: { kind: 'task', taskId: 'home' },
  });

  it('lists its home’s open question, sign-in, secret and pause gates, and nothing for a plain schedule', () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 'home', watchHome: true }), createTask({ id: 'plain' })],
      gates: [
        createGate({ id: 'q', taskId: 'home', type: 'question' }),
        createGate({ id: 's', taskId: 'home', type: 'sign_in' }),
        createGate({ id: 'k', taskId: 'home', type: 'secret' }),
        createGate({ id: 'old', taskId: 'home', type: 'question', status: 'answered' }),
        createGate({ id: 'f', taskId: 'home', type: 'failure', cause: 'budget' }),
        createGate({ id: 'r', taskId: 'home', type: 'review' }),
      ],
      patch: { schedules: { w: watch } },
    });
    expect(listAutomationGates(state, watch).map(({ gate }) => gate.id)).toEqual(['q', 's', 'k', 'f']);
    expect(listAutomationGates(state, watch)[0]?.home.id).toBe('home');
    const message = createSchedule({ id: 'm', target: { kind: 'task', taskId: 'plain' } });
    expect(listAutomationGates(state, message)).toEqual([]);
    expect(listAutomationGates(state, createSchedule({ id: 'n' }))).toEqual([]);
  });
});
