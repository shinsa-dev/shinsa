import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { ChatEvent } from '@shinsa/core';
import { type ModelSource, Transcripts } from '../../src/agents/index.ts';
import { startServer } from '../../src/http/index.ts';
import { createReadRoutes } from '../../src/http/reads.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, createTestOnboarding } from '../helpers/index.ts';
import { createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';

const running: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of running.splice(0)) await stop();
});

async function seedTasks(engine: Engine) {
  await engine.dispatch({
    type: 'repo.register',
    repo: {
      name: 'app',
      path: '/code/app',
      defaultBranch: 'main',
      remote: null,
      checkCommands: ['true'],
    },
    projectName: null,
  });
  const repoId = Object.keys(engine.state.repos)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Fix the tab scroll in the sidebar', repoId });
  const fixId = Object.keys(engine.state.tasks)[0] ?? '';
  await engine.dispatch({
    type: 'task.triage',
    taskId: fixId,
    title: 'Fix the tab scroll',
    repoId,
    size: 'small',
    branch: 'fix/tab-scroll',
    waitsOn: [],
  });
  await engine.dispatch({ type: 'worktree.ready', taskId: fixId, path: '/wt/fix', branch: 'fix/tab-scroll' });
  const runId = Object.keys(engine.state.runs)[0] ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Add search', repoId: null });
  const searchId = Object.keys(engine.state.tasks).find((id) => id !== fixId) ?? '';
  await engine.dispatch({ type: 'task.create', request: 'Old idea', repoId: null });
  const oldId = Object.keys(engine.state.tasks).find((id) => id !== fixId && id !== searchId) ?? '';
  await engine.dispatch({ type: 'task.cancel', taskId: oldId });
  await engine.dispatch({
    type: 'agent.ask',
    runId,
    gateId: 'gate-colour',
    question: 'Which colour?',
    context: null,
  });
  setSystemTime(new Date(2_000_000));
  await engine.dispatch({ type: 'task.prioritize', taskId: searchId, priority: 'low' });
  return { repoId, fixId, searchId, oldId, runId };
}

async function seed(engine: Engine) {
  setSystemTime(new Date(1_000_000));
  try {
    return await seedTasks(engine);
  } finally {
    setSystemTime();
  }
}

async function start() {
  const config = createTestConfig();
  const engine = new Engine(new EventLog(config.databasePath));
  const transcripts = new Transcripts(config.transcriptsDir);
  const http = startServer({
    engine,
    config,
    transcripts,
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
  });
  running.push(http.stop);
  const base = `http://127.0.0.1:${http.server.port}`;
  const read = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  const ids = await seed(engine);
  return { engine, transcripts, base, read, ...ids };
}

function titles(body: Record<string, unknown>) {
  return (body.tasks as { title: string }[]).map((task) => task.title);
}

describe('GET /api/tasks', () => {
  test('lists the open tasks, most recently changed first, with their handle, state, decision and handle link', async () => {
    const { read, base, fixId } = await start();
    const { status, body } = await read('/api/tasks');
    expect(status).toBe(200);
    expect(titles(body)).toEqual(['Add search', 'Fix the tab scroll']);
    expect((body.tasks as unknown[])[1]).toMatchObject({
      id: fixId,
      handle: 'T-1',
      stage: 'planning',
      priority: 'normal',
      mode: 'build',
      repo: 'app',
      branch: 'fix/tab-scroll',
      pullRequest: null,
      decision: { gateId: 'gate-colour', type: 'question', title: 'Which colour?' },
      url: `${base}/tasks/T-1`,
    });
    expect((body.tasks as unknown[])[0]).toMatchObject({
      handle: null,
      repo: null,
      decision: null,
      priority: 'low',
    });
    expect(titles((await read('/api/tasks?q=t-1')).body)).toEqual(['Fix the tab scroll']);
  });

  test('filters by what needs you, what is settled, or shows all', async () => {
    const { read } = await start();
    expect(titles((await read('/api/tasks?status=needs_you')).body)).toEqual(['Fix the tab scroll']);
    expect(titles((await read('/api/tasks?status=settled')).body)).toEqual(['Old idea']);
    expect(titles((await read('/api/tasks?status=all')).body).sort()).toEqual([
      'Add search',
      'Fix the tab scroll',
      'Old idea',
    ]);
  });

  test('every query word must appear in the title, request, branch or repository', async () => {
    const { read, repoId } = await start();
    expect(titles((await read('/api/tasks?q=TAB%20sidebar')).body)).toEqual(['Fix the tab scroll']);
    expect(titles((await read('/api/tasks?q=fix%2Ftab-scroll')).body)).toEqual(['Fix the tab scroll']);
    expect(titles((await read('/api/tasks?q=app%20search')).body)).toEqual([]);
    expect(titles((await read('/api/tasks?repo=app')).body)).toEqual(['Fix the tab scroll']);
    expect(titles((await read(`/api/tasks?repo=${repoId}`)).body)).toEqual(['Fix the tab scroll']);
    expect(titles((await read('/api/tasks?limit=1')).body)).toEqual(['Add search']);
    expect(titles((await read('/api/tasks?limit=100000')).body)).toHaveLength(2);
  });

  test('a filter or limit it does not understand is refused with what it takes', async () => {
    const { read } = await start();
    expect(await read('/api/tasks?status=later')).toEqual({
      status: 400,
      body: {
        error: { code: 'status_invalid', message: 'status must be one of open, needs_you, settled, all.' },
      },
    });
    for (const limit of ['0', '1.5', 'many']) {
      expect(await read(`/api/tasks?limit=${limit}`)).toEqual({
        status: 400,
        body: { error: { code: 'limit_invalid', message: 'limit must be a whole number of 1 or more.' } },
      });
    }
  });
});

describe('GET /api/tasks/:ref', () => {
  test('finds a task by its id, its handle, the start of its id or its exact title, and describes it', async () => {
    const { read, fixId, runId } = await start();
    const { body } = await read(`/api/tasks/${fixId}`);
    expect(body).toMatchObject({
      task: { id: fixId, title: 'Fix the tab scroll' },
      request: 'Fix the tab scroll in the sidebar',
      plan: null,
      summary: null,
      result: null,
      gates: [{ id: 'gate-colour', type: 'question' }],
      waitsOn: [],
      runs: [{ id: runId, role: 'agent', outcome: null, account: null, delegation: null }],
      suggestions: [],
    });
    expect(body.text).toContain('Fix the tab scroll');
    expect((body.activity as unknown[]).length).toBeGreaterThan(0);
    expect((await read(`/api/tasks/${fixId.slice(0, -6)}`)).body.task).toMatchObject({ id: fixId });
    expect((await read('/api/tasks/fix%20THE%20tab%20scroll')).body.task).toMatchObject({ id: fixId });
    expect((await read('/api/tasks/t-1')).body.task).toMatchObject({ id: fixId, handle: 'T-1' });
  });

  test('a ref that matches several tasks or none is refused', async () => {
    const { read } = await start();
    expect(await read('/api/tasks/0')).toEqual({
      status: 400,
      body: { error: { code: 'task_ambiguous', message: '“0” matches 3 tasks. Use the full id.' } },
    });
    expect(await read('/api/tasks/nope')).toEqual({
      status: 400,
      body: { error: { code: 'task_not_found', message: 'No task nope. `shinsa tasks list` lists them.' } },
    });
  });
});

describe('GET /api/tasks/:ref/chat', () => {
  async function startChat() {
    const server = await start();
    const entries: ChatEvent[] = [
      { type: 'user', from: 'shinsa', text: 'Plan it.', attachments: [] },
      { type: 'status', status: 'thinking' } as unknown as ChatEvent,
      { type: 'agent', phase: 'interim', text: 'Reading the code.' },
      { type: 'agent', phase: 'final', text: 'Here is the plan.' },
      { type: 'error', text: 'The tool failed.' } as unknown as ChatEvent,
      { type: 'user', from: 'you', text: 'Use flexbox.', attachments: [] },
    ];
    for (const entry of entries) server.transcripts.record(server.runId, entry);
    return server;
  }

  test('pages through what was said, oldest first after an index, the latest without one', async () => {
    const { read, fixId, runId } = await startChat();
    const latest = await read(`/api/tasks/${fixId}/chat`);
    expect(latest.body).toMatchObject({ taskId: fixId, runs: [{ id: runId, role: 'agent' }], next: null });
    expect(
      (latest.body.entries as { index: number; type: string; runId: string }[]).map((entry) => [
        entry.index,
        entry.type,
      ])
    ).toEqual([
      [0, 'user'],
      [2, 'agent'],
      [3, 'agent'],
      [4, 'error'],
      [5, 'user'],
    ]);
    const tail = await read(`/api/tasks/${fixId}/chat?limit=2`);
    expect((tail.body.entries as { index: number }[]).map((entry) => entry.index)).toEqual([4, 5]);
    expect(tail.body.next).toBeNull();
    const first = await read(`/api/tasks/${fixId}/chat?after=-1&limit=2`);
    expect((first.body.entries as { index: number }[]).map((entry) => entry.index)).toEqual([0, 2]);
    expect(first.body.next).toBe(2);
    const second = await read(`/api/tasks/${fixId}/chat?after=2&limit=2`);
    expect((second.body.entries as { index: number }[]).map((entry) => entry.index)).toEqual([3, 4]);
    expect(second.body.next).toBe(4);
    const empty = await read(`/api/tasks/${fixId}/chat?after=5`);
    expect(empty.body).toMatchObject({ entries: [], next: null });
  });

  test('picks the kinds of entry and the run to read', async () => {
    const { read, fixId, runId } = await startChat();
    const statuses = await read(`/api/tasks/${fixId}/chat?kinds=status,%20error&run=${runId}`);
    expect(
      (statuses.body.entries as { type: string; runId: string }[]).map((entry) => [entry.type, entry.runId])
    ).toEqual([
      ['status', runId],
      ['error', runId],
    ]);
    expect((await read(`/api/tasks/${fixId}/chat?run=other`)).body.entries).toEqual([]);
  });

  test('an unknown kind, a bad index or a missing task is refused', async () => {
    const { read, fixId } = await startChat();
    expect(await read(`/api/tasks/${fixId}/chat?kinds=agent,thoughts`)).toEqual({
      status: 400,
      body: {
        error: {
          code: 'kinds_invalid',
          message: 'kinds are user, agent, tool_call, tool_result, status, error, notice.',
        },
      },
    });
    for (const after of ['-2', 'x', '1.5']) {
      expect(await read(`/api/tasks/${fixId}/chat?after=${after}`)).toEqual({
        status: 400,
        body: { error: { code: 'after_invalid', message: 'after must be an index.' } },
      });
    }
    expect((await read('/api/tasks/nope/chat')).body).toMatchObject({ error: { code: 'task_not_found' } });
  });
});

describe('the other read endpoints', () => {
  test('settings with their keys, repositories, projects with their repositories and the focus, and schedules', async () => {
    const { read, engine, repoId } = await start();
    const settings = await read('/api/settings');
    expect(settings.body.settings).toEqual(JSON.parse(JSON.stringify(engine.state.settings)));
    expect(settings.body.keys).toContain('mergeMethod');
    expect((await read('/api/repos')).body).toMatchObject({ repos: [{ name: 'app', path: '/code/app' }] });
    await engine.dispatch({
      type: 'project.write',
      project: { name: 'Work', color: 'blue', key: 'WK', description: 'The day job.' },
    });
    const projectId = Object.keys(engine.state.projects)[0] ?? '';
    await engine.dispatch({ type: 'repo.update', repoId, patch: { projectId } });
    const expected = {
      projects: [
        {
          id: projectId,
          name: 'Work',
          key: 'WK',
          description: 'The day job.',
          folders: [],
          repos: [{ id: repoId, name: 'app', path: '/code/app' }],
        },
      ],
      focus: { projectId: null },
    };
    expect((await read('/api/projects')).body).toMatchObject(expected);
    expect((await read('/api/schedules')).body).toEqual({ schedules: [] });
  });

  test('memory lists every rule with the name of its project', async () => {
    const { read, engine } = await start();
    await engine.dispatch({ type: 'project.write', project: { name: 'Work', color: 'blue', key: 'WK' } });
    const projectId = Object.keys(engine.state.projects)[0] ?? '';
    await engine.dispatch({
      type: 'memory.write',
      memoryId: null,
      projectId: null,
      text: 'Never use em dashes.',
    });
    await engine.dispatch({ type: 'memory.write', memoryId: null, projectId, text: 'Use bun.' });
    expect((await read('/api/memory')).body).toMatchObject({
      memory: [
        { text: 'Never use em dashes.', project: null, status: 'kept' },
        { text: 'Use bun.', project: 'Work', projectId },
      ],
    });
  });

  test('delegations list every delegated run, or one task’s, and a missing task is refused', async () => {
    const { read, engine, runId, fixId } = await start();
    expect((await read('/api/delegations')).body).toEqual({ delegations: [] });
    await engine.dispatch({
      type: 'agent.delegate',
      runId,
      requestKey: 'req-1',
      title: 'Check the scroll code',
      brief: 'Find where the tab scroll is handled.',
      role: 'planner',
      mode: 'async',
      isolation: 'shared',
      baseCommit: null,
      provider: null,
      model: null,
    });
    const all = await read('/api/delegations');
    expect(all.body.delegations).toMatchObject([
      {
        taskId: fixId,
        role: 'planner',
        delegation: { title: 'Check the scroll code', parentRunId: runId, depth: 1 },
      },
    ]);
    expect((await read(`/api/delegations?task=${fixId}`)).body).toEqual(all.body);
    expect((await read('/api/delegations?task=Add%20search')).body).toEqual({ delegations: [] });
    expect((await read('/api/delegations?task=nope')).body).toMatchObject({
      error: { code: 'task_not_found' },
    });
  });

  test('activity lists what Shinsa did on your behalf', async () => {
    const { read, engine, searchId } = await start();
    expect((await read('/api/activity')).body).toEqual({ actions: [] });
    await engine.dispatch(
      { type: 'task.prioritize', taskId: searchId, priority: 'high' },
      { onBehalf: true }
    );
    expect((await read('/api/activity')).body).toMatchObject({
      actions: [{ command: 'task.prioritize', taskId: searchId }],
    });
  });
});

describe('a task further along', () => {
  test('shows its pull request, its plan, what it waits on, and the account and delegation of each run', async () => {
    const { engine } = createStubEngine((state) => {
      state.repos['repo-1'] = createRepo();
      state.tasks['task-1'] = createTask({
        activity: [],
        findings: [],
        phases: [],
        stage: 'shipping',
        waitsOn: ['task-2'],
        pullRequest: {
          number: 7,
          state: 'open',
          checks: 'passing',
          url: 'https://github.com/acme/app/pull/7',
        },
        plan: {
          version: 2,
          approvedAt: 5,
          document: { goal: 'Fix it.', phases: [{ title: 'Edit', detail: 'Edit it.' }] },
        },
      } as never);
      state.tasks['task-2'] = createTask({
        id: 'task-2',
        title: 'Add search',
        activity: [],
        phases: [],
      } as never);
      state.runs['run-3'] = createRun({
        id: 'run-3',
        startedAt: 3,
        delegation: { title: 'Check', parentRunId: 'run-2', depth: 2 },
      } as never);
      state.runs['run-1'] = createRun({ account: { id: 'acc-1', email: null } } as never);
      state.runs['run-2'] = createRun({
        id: 'run-2',
        startedAt: 2,
        account: { id: 'acc-2', email: 'me@example.com' },
        delegation: { title: 'Look', parentRunId: 'run-1', depth: 1 },
      } as never);
    });
    const routes = createReadRoutes(engine, new Transcripts(createTempDir()));
    const ask = async (path: string) => {
      const request = new Request(`http://127.0.0.1:5180${path}`);
      const pathname = new URL(request.url).pathname;
      const route = routes.find((candidate) => candidate.pattern.test(pathname));
      const match = route?.pattern.exec(pathname);
      if (!route || !match) throw new Error(`no route for ${path}`);
      return (await (await route.respond(match, request)).json()) as Record<string, unknown>;
    };
    const detail = await ask('/api/tasks/task-1');
    expect(detail.task).toMatchObject({
      repo: 'app',
      pullRequest: { number: 7, state: 'open', checks: 'passing', url: 'https://github.com/acme/app/pull/7' },
      url: 'http://127.0.0.1:5180/tasks/task-1',
    });
    expect(detail.plan).toMatchObject({ version: 2, approved: true, document: { goal: 'Fix it.' } });
    expect(detail.text).toContain('Plan (version 2, approved): Fix it.');
    expect(detail.waitsOn).toEqual([{ id: 'task-2', title: 'Add search' }]);
    expect(detail.runs).toMatchObject([
      { id: 'run-1', account: 'acc-1', delegation: null },
      {
        id: 'run-2',
        account: 'me@example.com',
        delegation: { title: 'Look', parentRunId: 'run-1', depth: 1 },
      },
      { id: 'run-3', account: null, delegation: { title: 'Check', parentRunId: 'run-2', depth: 2 } },
    ]);
    expect(await ask('/api/delegations')).toMatchObject({
      delegations: [
        { id: 'run-2', taskId: 'task-1' },
        { id: 'run-3', taskId: 'task-1' },
      ],
    });
  });
});
