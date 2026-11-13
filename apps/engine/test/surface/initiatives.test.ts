import { describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import { createFakeClient, createTaskDetail, findSpec, runSpec } from './fixtures.ts';

const VIEW = {
  id: 'init-1',
  name: 'Chat split',
  description: 'Restart the chat stack.',
  phases: [
    { id: 'phase-dock', name: 'Dock' },
    { id: 'phase-studio', name: 'Studio' },
  ],
  lead: { id: 'lead', handle: 'SW-100', title: 'Lead', status: 'working' },
  members: 3,
  progress: [
    { phase: { id: 'phase-dock', name: 'Dock' }, total: 2, shipped: 1, dropped: 0 },
    { phase: null, total: 1, shipped: 0, dropped: 1 },
  ],
  createdAt: 1,
  updatedAt: 1,
  url: 'http://127.0.0.1:5180/initiatives/init-1',
};

const BARE = { ...VIEW, id: 'init-2', name: 'Billing', phases: [], lead: null, members: 1, progress: [] };

const LIST = { initiatives: [VIEW, BARE] };

function createTaskView(id: string, title: string, pullRequest: number | null = null) {
  return {
    id,
    handle: id.toUpperCase(),
    title,
    status: 'working',
    pullRequest: pullRequest ? { number: pullRequest } : null,
  };
}

const SHEET = {
  initiative: VIEW,
  report: {
    narrative: 'The dock is in review.\nThe studio waits on it.',
    at: 7,
  },
  needsYou: [{ task: createTaskView('sw-104', 'Account tools'), reason: 'Its plan waits for you.' }],
  now: [createTaskView('sw-103', 'Write guard')],
  next: [
    {
      phase: { id: 'phase-studio', name: 'Studio' },
      tasks: [
        {
          task: createTaskView('sw-105', 'Studio chat'),
          waitsOn: [{ id: 'sw-104', handle: null, title: 'Account tools', status: 'planning' }],
        },
      ],
    },
    { phase: null, tasks: [{ task: createTaskView('sw-106', 'Onboarding'), waitsOn: [] }] },
  ],
  shipped: [createTaskView('sw-101', 'Dock', 5079)],
  dropped: [{ task: createTaskView('sw-102', 'Old dock'), reason: 'Cancelled' }],
  decisions: [
    {
      task: { id: 'sw-101', handle: 'SW-101', title: 'Dock' },
      kind: 'plan',
      title: 'Dock',
      text: 'Rewrite the dock.',
      at: 2,
    },
    {
      task: { id: 'sw-101', handle: 'SW-101', title: 'Dock' },
      kind: 'call',
      title: 'Hold',
      text: 'Keep the hold.',
      at: 3,
    },
  ],
};

describe('shinsa initiatives', () => {
  test('lists every initiative with its tasks, what shipped and its lead', async () => {
    const fake = createFakeClient({ '/api/initiatives': LIST });
    expect((await runSpec(fake, ['initiatives', 'list'])).text.split('\n')).toEqual([
      'Chat split  (init-1) 3 tasks, 1 shipped, led by SW-100',
      'Billing  (init-2) 1 task, 0 shipped',
    ]);
    const empty = createFakeClient({ '/api/initiatives': { initiatives: [] } });
    expect((await runSpec(empty, ['initiatives', 'list'])).text).toBe('No initiatives yet.');
  });

  test('shows the sheet section by section, leaving out the empty ones', async () => {
    const fake = createFakeClient({ '/api/initiatives/Chat%20split': SHEET });
    const { text } = await runSpec(fake, ['initiatives', 'show', 'Chat split']);
    expect(text.split('\n')).toEqual([
      'Chat split, 3 tasks, 1 shipped, led by SW-100',
      'Restart the chat stack.',
      '',
      'From the lead:',
      '  The dock is in review.',
      '  The studio waits on it.',
      '',
      'Phases:',
      '  Dock: 1 of 2 shipped',
      '  No phase: 1 dropped',
      '',
      'Needs you:',
      '  SW-104  Account tools (working): Its plan waits for you.',
      '',
      'Now:',
      '  SW-103  Write guard (working)',
      '',
      'Next, Studio:',
      '  SW-105  Studio chat (working), waits on sw-104',
      '',
      'Next, no phase:',
      '  SW-106  Onboarding (working)',
      '',
      'Shipped:',
      '  SW-101  Dock (working, #5079)',
      '',
      'Dropped:',
      '  SW-102  Old dock (working): Cancelled',
      '',
      'Decisions:',
      '  SW-101 plan: Rewrite the dock.',
      '  SW-101 call: Keep the hold.',
      '',
      'http://127.0.0.1:5180/initiatives/init-1',
    ]);
    const bare = createFakeClient({
      '/api/initiatives/init-2': {
        initiative: { ...BARE, description: '' },
        report: null,
        needsYou: [],
        now: [],
        next: [],
        shipped: [],
        dropped: [],
        decisions: [],
      },
    });
    expect((await runSpec(bare, ['initiatives', 'show', 'init-2'])).text).toBe(
      'Billing, 1 task, 0 shipped\nNo description.\n\nhttp://127.0.0.1:5180/initiatives/init-1'
    );
  });

  test('changes an initiative found by name, keeping the ids of phases it names again', async () => {
    const fake = createFakeClient({ '/api/initiatives': LIST });
    expect(
      (
        await runSpec(fake, [
          'initiatives',
          'write',
          'chat split',
          '--phases',
          'studio',
          '--phases',
          'Polish',
          '--name',
          'Chat',
        ])
      ).text
    ).toContain('Changed.');
    await runSpec(fake, ['initiatives', 'write', 'init-2', '--description', 'Invoices.']);
    expect(fake.sent).toEqual([
      {
        type: 'initiative.write',
        initiativeId: 'init-1',
        name: 'Chat',
        phases: [
          { id: 'phase-studio', name: 'studio' },
          { id: null, name: 'Polish' },
        ],
      },
      { type: 'initiative.write', initiativeId: 'init-2', name: 'Billing', description: 'Invoices.' },
    ]);
    await expect(runSpec(fake, ['initiatives', 'write', 'Search', '--name', 'X'])).rejects.toMatchObject({
      code: 'initiative_not_found',
      message: 'No initiative Search. `shinsa initiatives list` lists them.',
    });
  });

  test('shows an initiative to a team and stops, both left to the human', async () => {
    const fake = createFakeClient({
      '/api/initiatives': LIST,
      '/api/remote': { teams: [{ id: 'team-1', name: 'Platform' }] },
    });
    expect(
      (await runSpec(fake, ['initiatives', 'add-to-team', 'Chat split', '--team', 'Platform'])).text
    ).toBe('The team sees the initiative now.');
    expect(
      (await runSpec(fake, ['initiatives', 'remove-from-team', 'init-1', '--team', 'team-1'])).text
    ).toBe('The team no longer sees the initiative.');
    expect(fake.sent).toEqual([
      { type: 'initiative.add_to_team', initiativeId: 'init-1', teamId: 'team-1' },
      { type: 'initiative.remove_from_team', initiativeId: 'init-1', teamId: 'team-1' },
    ]);
    expect(findSpec(['initiatives', 'add-to-team']).humanOnly).toBe(true);
    expect(findSpec(['initiatives', 'remove-from-team']).humanOnly).toBe(true);
  });

  test('makes an initiative from a task', async () => {
    const fake = createFakeClient({ '/api/tasks/SW-101': createTaskDetail({ task: { id: 'task-101' } }) });
    expect((await runSpec(fake, ['initiatives', 'adopt', 'SW-101'])).text).toContain('Made the initiative.');
    expect(fake.sent).toEqual([{ type: 'initiative.adopt_task', taskId: 'task-101' }]);
  });
});

describe('shinsa tasks join-initiative and leave-initiative', () => {
  const responses = {
    '/api/initiatives': LIST,
    '/api/tasks/SW-105': createTaskDetail({ task: { id: 'task-105' } }),
  };

  test('adds a task to an initiative, in a phase found by name or id, or in none', async () => {
    const fake = createFakeClient(responses);
    expect(
      (await runSpec(fake, ['tasks', 'join-initiative', 'SW-105', 'Chat split', '--phase', 'studio'])).text
    ).toContain('Added.');
    await runSpec(fake, ['tasks', 'join-initiative', 'SW-105', 'init-1', '--phase', 'phase-dock']);
    await runSpec(fake, ['tasks', 'join-initiative', 'SW-105', 'Billing']);
    expect(fake.sent).toEqual([
      { type: 'task.join_initiative', taskId: 'task-105', initiativeId: 'init-1', phaseId: 'phase-studio' },
      { type: 'task.join_initiative', taskId: 'task-105', initiativeId: 'init-1', phaseId: 'phase-dock' },
      { type: 'task.join_initiative', taskId: 'task-105', initiativeId: 'init-2', phaseId: null },
    ]);
  });

  test('adds a task to an initiative a teammate shared, naming the team and the teammate’s machine', async () => {
    const shared = {
      ...BARE,
      id: 'init-kai',
      name: 'Dashboard',
      phases: [{ id: 'phase-api', name: 'API' }],
      teamId: 'team-1',
      instanceId: 'laptop',
    };
    const fake = createFakeClient({
      ...responses,
      '/api/teams/tasks': { machines: [], tasks: [], initiatives: [shared] },
    });
    await runSpec(fake, ['tasks', 'join-initiative', 'SW-105', 'dashboard', '--phase', 'API']);
    expect(fake.sent).toEqual([
      {
        type: 'task.join_initiative',
        taskId: 'task-105',
        initiativeId: 'init-kai',
        phaseId: 'phase-api',
        team: { teamId: 'team-1', instanceId: 'laptop', name: 'Dashboard' },
      },
    ]);
  });

  test('names no initiative it finds in neither this machine’s nor the team’s', async () => {
    const quiet = createFakeClient({ ...responses, '/api/teams/tasks': { machines: [], tasks: [] } });
    await expect(runSpec(quiet, ['tasks', 'join-initiative', 'SW-105', 'Search'])).rejects.toMatchObject({
      code: 'initiative_not_found',
    });
    const offline = createFakeClient(responses);
    await expect(runSpec(offline, ['tasks', 'join-initiative', 'SW-105', 'Search'])).rejects.toMatchObject({
      code: 'initiative_not_found',
    });
  });

  test('refuses a phase the initiative does not have, naming the ones it has', async () => {
    const fake = createFakeClient(responses);
    await expect(
      runSpec(fake, ['tasks', 'join-initiative', 'SW-105', 'Chat split', '--phase', 'Polish'])
    ).rejects.toMatchObject({
      code: 'initiative_phase_not_found',
      message: 'Chat split has no phase Polish. Its phases are Dock, Studio.',
    });
    await expect(
      runSpec(fake, ['tasks', 'join-initiative', 'SW-105', 'Billing', '--phase', 'Polish'])
    ).rejects.toMatchObject({
      message: 'Billing has no phases yet. Add them with `shinsa initiatives write --id`.',
    });
  });

  test('takes a task out of its initiative', async () => {
    const fake = createFakeClient(responses);
    expect((await runSpec(fake, ['tasks', 'leave-initiative', 'SW-105'])).text).toContain('Taken out.');
    expect(fake.sent).toEqual([
      { type: 'task.join_initiative', taskId: 'task-105', initiativeId: null, phaseId: null },
    ]);
  });
});

describe('shinsa tasks message to a teammate’s lead', () => {
  const lead = {
    task: { id: 'lead-kai', handle: 'KAI-9', title: 'Lead the dashboard', stage: 'leading' },
    gates: [],
    project: null,
    repo: null,
    owner: 'kai',
    machine: 'Laptop',
    teamId: 'team-1',
    instanceId: 'laptop',
  };
  const shared = { ...BARE, id: 'init-kai', leadTaskId: 'lead-kai', teamId: 'team-1', instanceId: 'laptop' };
  const feed = { machines: [], tasks: [lead], initiatives: [shared] };

  function createTeammateClient(answers: Record<string, unknown>, relay = true) {
    const fake = createFakeClient(answers);
    const relayed: { instanceId: string; command: unknown }[] = [];
    const client = {
      ...fake.client,
      api: {
        ...fake.client.api,
        tasks: {
          ...fake.client.api.tasks,
          read: () => Effect.fail(new DomainError({ code: 'task_not_found', message: 'No task KAI-9.' })),
        },
      },
      ...(relay
        ? {
            relay: (instanceId: string, command: unknown) =>
              Effect.sync(() => {
                relayed.push({ instanceId, command });
              }),
          }
        : {}),
    };
    return { client: { ...fake, client: client as typeof fake.client }, relayed };
  }

  test('sends it to the lead’s machine when no task of this machine is called that', async () => {
    const { client, relayed } = createTeammateClient({ '/api/teams/tasks': feed });
    const { text } = await runSpec(client, [
      'tasks',
      'message',
      'kai-9',
      'wait',
      'for',
      'me',
      '--as',
      'feedback',
    ]);
    expect(text).toBe('Sent to the lead on Laptop.');
    expect(relayed).toEqual([
      {
        instanceId: 'laptop',
        command: { type: 'task.message', taskId: 'lead-kai', text: 'wait for me', kind: 'feedback' },
      },
    ]);
    await runSpec(client, ['tasks', 'message', 'lead-kai', 'hi']);
    expect(relayed[1]?.command).toEqual({ type: 'task.message', taskId: 'lead-kai', text: 'hi' });
  });

  test('names the missing task when it is no teammate’s lead, or this machine relays nothing', async () => {
    const quiet = createTeammateClient({ '/api/teams/tasks': { ...feed, initiatives: [] } });
    await expect(runSpec(quiet.client, ['tasks', 'message', 'KAI-9', 'hi'])).rejects.toMatchObject({
      code: 'task_not_found',
    });
    const offline = createTeammateClient({});
    await expect(runSpec(offline.client, ['tasks', 'message', 'KAI-9', 'hi'])).rejects.toMatchObject({
      code: 'task_not_found',
    });
    const blank = createTeammateClient({ '/api/teams/tasks': feed });
    await expect(runSpec(blank.client, ['tasks', 'message', ' ', 'hi'])).rejects.toMatchObject({
      code: 'task_not_found',
    });
    const alone = createTeammateClient({ '/api/teams/tasks': feed }, false);
    await expect(runSpec(alone.client, ['tasks', 'message', 'KAI-9', 'hi'])).rejects.toMatchObject({
      code: 'task_not_found',
    });
    expect([quiet, offline, blank, alone].flatMap((entry) => entry.relayed)).toEqual([]);
  });

  test('passes on any other refusal', async () => {
    const fake = createFakeClient({});
    await expect(runSpec(fake, ['tasks', 'message', 'KAI-9', 'hi'])).rejects.toMatchObject({
      code: 'not_found',
    });
  });
});
