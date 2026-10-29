import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  ANY_REPOSITORY,
  type AutomationDraft,
  createAutomationDraft,
  describeAutomationFacts,
  describeAutomationSaved,
  describeReadsEmpty,
  listAutomationFiled,
  listAutomationGates,
  listAutomationReads,
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

  it('opens from its home task, and says what it reads and when', () => {
    expect(resolveAutomationPath('s 1')).toBe('/automations/s%201');
    expect(selectWatchOfHome(state, 'home')?.id).toBe('s1');
    expect(selectWatchOfHome(state, 'other')).toBeNull();
    expect(selectWatchSource(state, watch)).toBe(SLACK);
    expect(selectWatchSource(state, createSchedule({ id: 'plain' }))).toBeNull();
    expect(describeAutomationFacts(state, watch)).toBe(
      'Watch · Reads slack: The #feedback channel · Every hour'
    );
    expect(describeAutomationFacts(state, createSchedule({ id: 'p', enabled: false }))).toBe(
      'Schedule · Every hour · Paused'
    );
  });

  it('lists every read newest first, with what it filed, and the runs it skipped or failed', () => {
    expect(listAutomationFiled(state, watch).map((task) => task.id)).toEqual(['f1', 'f0']);
    expect(
      listAutomationReads(state, watch).map((read) => [
        read.label,
        read.tone,
        read.summary,
        read.filed.length,
      ])
    ).toEqual([
      ['Failed', 'red', 'It broke.', 0],
      ['Skipped', 'neutral', 'The task was at work.', 0],
      ['Did not finish', 'amber', null, 0],
      ['Reading now', 'neutral', null, 0],
      ['Read', 'neutral', 'Read 4 messages; filed 1.', 1],
    ]);
    expect(listAutomationReads(state, createSchedule({ id: 'plain' }))).toEqual([]);
  });

  it('says why it has no read yet', () => {
    expect(describeReadsEmpty(watch)).toBe('No read yet. The first one starts at its next run.');
    expect(describeReadsEmpty({ ...watch, enabled: false })).toBe('No read yet, and it is paused.');
  });
});

describe('the decisions a watch waits on', () => {
  const watch = createSchedule({
    id: 'w',
    source: { projectId: 'p1', server: 'slack' },
    target: { kind: 'task', taskId: 'home' },
  });

  it('lists its home’s open question, sign-in and secret gates, and nothing for a plain schedule', () => {
    const state = createShinsaState({
      tasks: [createTask({ id: 'home', watchHome: true }), createTask({ id: 'plain' })],
      gates: [
        createGate({ id: 'q', taskId: 'home', type: 'question' }),
        createGate({ id: 's', taskId: 'home', type: 'sign_in' }),
        createGate({ id: 'k', taskId: 'home', type: 'secret' }),
        createGate({ id: 'old', taskId: 'home', type: 'question', status: 'answered' }),
        createGate({ id: 'r', taskId: 'home', type: 'review' }),
      ],
      patch: { schedules: { w: watch } },
    });
    expect(listAutomationGates(state, watch).map(({ gate }) => gate.id)).toEqual(['q', 's', 'k']);
    expect(listAutomationGates(state, watch)[0]?.home.id).toBe('home');
    const message = createSchedule({ id: 'm', target: { kind: 'task', taskId: 'plain' } });
    expect(listAutomationGates(state, message)).toEqual([]);
    expect(listAutomationGates(state, createSchedule({ id: 'n' }))).toEqual([]);
  });
});
