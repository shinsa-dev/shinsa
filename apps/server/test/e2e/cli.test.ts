import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { type CliIo, runCli } from '../../src/cli/index.ts';
import { startServer } from '../../src/http/index.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createTestOnboarding } from '../helpers/index.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await world?.dispose();
  world = null;
});

async function open() {
  world = await World.create();
  const http = startServer({
    engine: world.engine,
    config: world.config,
    transcripts: new Transcripts(world.config.transcriptsDir),
    evidence: new EvidenceStore(world.config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(world.engine, world.config).onboarding,
  });
  stops.push(http.stop);
  return { w: world, port: String(http.server.port) };
}

async function shinsa(port: string, ...args: string[]) {
  const out: string[] = [];
  const errors: string[] = [];
  const io: CliIo = {
    env: { SHINSA_PORT: port, SHINSA_HOME: world?.config.home },
    cwd: '/code/app',
    write: (line = '') => out.push(line),
    writeError: (line) => errors.push(line),
    openApp: () => Promise.resolve(),
    readRepoRoot: () => Promise.resolve(null),
    wakeEngine: () => Promise.resolve(false),
    engine: { bundled: false, uid: 0, launchctl: () => Promise.resolve({ ok: false, output: '' }) },
    runEngine: () => Promise.reject(new Error('not in this test')),
    onShutdown: () => undefined,
  };
  const code = await runCli(args, io);
  return { code, text: out.join('\n'), errors };
}

async function shinsaJson<T>(port: string, ...args: string[]) {
  const { code, text } = await shinsa(port, ...args, '--json');
  expect(code).toBe(0);
  return JSON.parse(text) as T;
}

describe('the command line drives the whole lifecycle of a task', () => {
  test('create, read, approve the review, merge, and the settings it changed', async () => {
    const { w, port } = await open();
    const repo = w.state.repos[w.repoId]?.name ?? '';

    const created = await shinsaJson<{ taskId: string }>(
      port,
      'tasks',
      'create',
      'Add the greeting files',
      '--repo',
      repo,
      '--priority',
      'high'
    );
    expect(w.task(created.taskId)).toMatchObject({ priority: 'high', repoId: w.repoId });

    await w.untilGate(created.taskId, 'review');
    const listed = await shinsaJson<{ tasks: { id: string; decision: { type: string } | null }[] }>(
      port,
      'tasks',
      'list',
      '--status',
      'needs_you'
    );
    expect(listed.tasks.map((task) => [task.id, task.decision?.type])).toEqual([[created.taskId, 'review']]);

    const shown = await shinsa(port, 'tasks', 'show', created.taskId.slice(0, 13));
    expect(shown.text).toContain('changes to review');

    const chat = await shinsaJson<{ entries: { type: string }[] }>(port, 'tasks', 'chat', created.taskId);
    expect(chat.entries.length).toBeGreaterThan(0);

    const approved = await shinsa(port, 'reviews', 'approve', created.taskId);
    expect(approved).toMatchObject({ code: 0 });
    expect(approved.text).toContain('Approved.');
    await w.until('the pull request to open', () => w.github.pulls.length === 1);
    w.github.update(1, { checks: 'passing' });
    await w.sync(created.taskId);
    await w.untilGate(created.taskId, 'merge');

    expect((await shinsa(port, 'merges', 'approve', created.taskId)).code).toBe(0);
    await w.untilStage(created.taskId, 'merged');

    expect((await shinsa(port, 'settings', 'set', 'approvePlans', 'true')).code).toBe(0);
    expect((await shinsa(port, 'settings', 'set', 'maxFixRounds', '3')).code).toBe(0);
    expect(w.state.settings).toMatchObject({ approvePlans: true, maxFixRounds: 3 });
    expect((await shinsa(port, 'settings', 'get', 'approvePlans')).text).toBe('approvePlans = true');
  });

  test('an answer to a plan, a question and a revision goes to the right gate', async () => {
    const { w, port } = await open();
    await shinsa(port, 'settings', 'set', 'approvePlans', 'true');
    const { taskId } = await shinsaJson<{ taskId: string }>(
      port,
      'tasks',
      'create',
      'Add the greeting files',
      '--repo',
      w.repoId,
      '--plan-first'
    );
    await w.untilGate(taskId, 'plan');
    const revised = await shinsa(port, 'plans', 'revise', taskId, 'Keep', 'it', 'to', 'one', 'phase');
    expect(revised.text).toContain('Asked for changes.');
    await w.untilGate(taskId, 'plan');
    expect(w.task(taskId).plan?.feedback).toBe('Keep it to one phase');

    const refused = await shinsa(port, 'reviews', 'approve', taskId, '--json');
    expect(refused.code).toBe(1);
    expect(JSON.parse(refused.text)).toMatchObject({ error: { code: 'gate_not_found' } });

    expect((await shinsa(port, 'plans', 'approve', taskId)).code).toBe(0);
    await w.until('building to start', () => w.task(taskId).stage !== 'awaiting_plan');
  });

  test('the same idempotency key creates the task once', async () => {
    const { w, port } = await open();
    const first = await shinsaJson<{ taskId: string }>(
      port,
      'tasks',
      'create',
      'Add the greeting files',
      '--repo',
      w.repoId,
      '--idempotency-key',
      'retry-1'
    );
    const again = await shinsaJson<{ taskId: string }>(
      port,
      'tasks',
      'create',
      'Add the greeting files',
      '--repo',
      w.repoId,
      '--idempotency-key',
      'retry-1'
    );
    expect(again.taskId).toBe(first.taskId);
    expect(Object.keys(w.state.tasks)).toEqual([first.taskId]);
  });

  test('schedules, follow-ups, focus and the health check', async () => {
    const { w, port } = await open();
    const written = await shinsa(
      port,
      'schedules',
      'write',
      '--name',
      'Morning check',
      '--message',
      'Check the dependencies',
      '--daily-at',
      '09:00',
      '--weekdays',
      '1,2,3,4,5',
      '--new-task',
      '--repo',
      w.repoId,
      '--time-zone',
      'Europe/Berlin'
    );
    expect(written.code).toBe(0);
    const [schedule] = Object.values(w.state.schedules);
    expect(schedule).toMatchObject({
      name: 'Morning check',
      trigger: { kind: 'daily', time: '09:00', weekdays: [1, 2, 3, 4, 5] },
      target: { kind: 'new_task', repoId: w.repoId },
      createdBy: { kind: 'you' },
    });
    expect((await shinsa(port, 'schedules', 'disable', schedule?.id ?? '')).code).toBe(0);
    expect(w.state.schedules[schedule?.id ?? '']?.enabled).toBe(false);
    expect((await shinsa(port, 'schedules', 'list')).text).toContain('Morning check  (paused)');
    expect((await shinsa(port, 'schedules', 'delete', schedule?.id ?? '')).code).toBe(0);
    expect(w.state.schedules).toEqual({});

    expect((await shinsa(port, 'projects', 'write', '--name', 'Work', '--color', 'blue')).code).toBe(0);
    expect((await shinsa(port, 'projects', 'list')).text).toMatch(
      /^WOR {4}Work {2}\(0 repositories\) {2}\S+$/
    );
    expect((await shinsa(port, 'projects', 'write', '--id', 'wor', '--key', 'wk')).code).toBe(0);
    expect(Object.values(w.state.projects)).toEqual([expect.objectContaining({ name: 'Work', key: 'WK' })]);
    expect((await shinsa(port, 'focus', 'set', 'WK')).code).toBe(0);
    expect((await shinsa(port, 'focus', 'show')).text).toBe('Focused on Work.');
    expect((await shinsa(port, 'focus', 'clear')).code).toBe(0);
    expect((await shinsa(port, 'projects', 'remove', 'work')).code).toBe(0);
    expect(w.state.projects).toEqual({});

    expect((await shinsa(port, 'health')).text).toMatch(/^Healthy\./);
    expect((await shinsa(port, 'tasks', '--help')).text).toContain('shinsa tasks create');
    expect((await shinsa(port, 'tasks', 'create', '--help')).text).toContain('--plan-first');
  });
});
