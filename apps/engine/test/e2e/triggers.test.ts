import { afterEach, describe, expect, setDefaultTimeout, setSystemTime, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Gate, listOpenGates, type Task } from '@shinsa/core';
import type { ModelSource } from '../../src/agents/index.ts';
import { ProviderRegistry } from '../../src/agents/providers/index.ts';
import { inspectRepo } from '../../src/git/index.ts';
import { type Shinsa, startShinsa } from '../../src/serve.ts';
import { createGitRepo, createTempDir, createTestConfig, until } from '../helpers/index.ts';
import { type AgentScript, FakeAgents, PLAN, toolPlan } from './harness.ts';

setDefaultTimeout(30_000);

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const SECRET = 'correct horse battery staple';

afterEach(() => {
  setSystemTime();
});

const models = { listModels: () => Promise.resolve([]) } as unknown as ModelSource;

interface Boot {
  shinsa: Shinsa;
  agents: FakeAgents;
  repoId: string;
  dataDir: string;
  home: string;
}

async function boot(): Promise<Boot> {
  const repo = await createGitRepo();
  const config = createTestConfig(createTempDir(), { roots: [repo.root] });
  const agents = new FakeAgents();
  const shinsa = await startShinsa(config, {
    models,
    resolveLogin: () => Promise.resolve(null),
    providers: new ProviderRegistry([agents.provider('claude', 'Claude')]),
    triage: (_state, task) =>
      Promise.resolve({
        title: task.request.split('\n')[0]?.slice(0, 40) ?? 'Task',
        repoPath: repo.path,
        size: 'small',
        branch: `feat/t-${task.id.slice(-8)}`,
        waitsOn: [],
      }),
    timeZone: 'UTC',
    scheduleClock: { minDelayMs: 0, maxDelayMs: 20 },
  });
  agents.state = () => shinsa.engine.state;
  const candidate = await inspectRepo(repo.path);
  await shinsa.engine.dispatch({
    type: 'repo.register',
    repo: { ...candidate, checkCommands: ['true'] },
    projectName: null,
  });
  const repoId = Object.keys(shinsa.engine.state.repos)[0] ?? '';
  return { shinsa, agents, repoId, dataDir: config.dataDir, home: config.home };
}

async function withWorld(body: (world: Boot) => Promise<void>) {
  const world = await boot();
  try {
    await body(world);
  } finally {
    await world.shinsa.stop();
  }
}

async function createTask(world: Boot, request: string) {
  const before = new Set(Object.keys(world.shinsa.engine.state.tasks));
  await world.shinsa.engine.dispatch({ type: 'task.create', request, repoId: world.repoId });
  const taskId = Object.keys(world.shinsa.engine.state.tasks).find((id) => !before.has(id));
  if (!taskId) throw new Error('no task');
  return taskId;
}

function tasksFrom(world: Boot, scheduleId: string): Task[] {
  return Object.values(world.shinsa.engine.state.tasks).filter((task) => task.scheduleId === scheduleId);
}

function openGate(world: Boot, taskId: string, predicate: (gate: Gate) => boolean) {
  return listOpenGates(world.shinsa.engine.state, taskId).find(predicate);
}

function postJson(world: Boot, path: string, body: unknown) {
  return fetch(`${world.shinsa.url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: world.shinsa.url,
    },
    body: JSON.stringify(body),
  });
}

function readEverything(dir: string): string {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== 'secrets.json')
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'latin1'))
    .join('\n');
}

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function scheduling(input: Record<string, unknown>, replies: string[]): AgentScript {
  return async (agent) => {
    replies.push(await agent.call('set_schedule', input));
    await agent.call('propose_plan', toolPlan(PLAN));
  };
}

describe('a schedule, end to end', () => {
  test('fires on time, catches a missed run up once on wake, and skips while its last task is open', async () => {
    const start = Date.parse('2026-10-23T08:00:00Z');
    setSystemTime(start);
    await withWorld(async (world) => {
      const replies: string[] = [];
      world.agents.queue(
        'plan',
        scheduling(
          { name: 'Audit', message: 'Audit the dependencies.', every_minutes: 60, new_task: true },
          replies
        )
      );
      await createTask(world, 'Set up the audit');
      await until('the schedule', () => Object.keys(world.shinsa.engine.state.schedules).length === 1);
      const schedule = Object.values(world.shinsa.engine.state.schedules)[0];
      if (!schedule) throw new Error('no schedule');
      expect(schedule.nextRunAt).toBe(start + HOUR);
      expect(replies[0]).toContain('Every hour. Next run 2026-10-23T09:00:00.000Z. Starts a new task.');

      const wake = start + 5 * HOUR + 7 * MINUTE;
      setSystemTime(wake);
      await until('the catch-up run', () => tasksFrom(world, schedule.id).length === 1);
      const caught = world.shinsa.engine.state.schedules[schedule.id];
      expect(caught?.runs.map((run) => [run.outcome, run.at])).toEqual([['sent', wake]]);
      expect(caught?.nextRunAt).toBe(wake + HOUR);
      const first = tasksFrom(world, schedule.id)[0] as Task;
      expect(first.request).toBe('Audit the dependencies.');
      expect(first.activity[0]?.text).toBe('Started by the schedule “Audit”');

      setSystemTime(wake + HOUR);
      await until(
        'the skipped run',
        () => (world.shinsa.engine.state.schedules[schedule.id]?.runs.length ?? 0) === 2
      );
      expect(world.shinsa.engine.state.schedules[schedule.id]).toMatchObject({ runCount: 1 });
      expect(world.shinsa.engine.state.schedules[schedule.id]?.runs[1]?.outcome).toBe('skipped');

      await world.shinsa.engine.dispatch({ type: 'task.cancel', taskId: first.id });
      setSystemTime(wake + 2 * HOUR);
      await until('the next task', () => tasksFrom(world, schedule.id).length === 2);
      expect(world.shinsa.engine.state.schedules[schedule.id]?.runCount).toBe(2);
    });
  });
});

describe('a signed webhook and its secret, end to end', () => {
  test('a verified delivery starts a task; a forgery and a replay do not; the secret is never written down', async () => {
    await withWorld(async (world) => {
      const replies: string[] = [];
      world.agents.queue('plan', async (agent) => {
        const saved = await agent.call('request_secret', {
          label: 'GitHub webhook secret',
          reason: 'Paste the secret from the repository’s webhook settings.',
        });
        replies.push(saved);
        const ref = /secret-ref:[0-9a-f]{32}/.exec(saved)?.[0];
        replies.push(
          await agent.call('set_schedule', {
            name: 'Review pushes',
            message: 'Review the push to {{body.ref}} ({{body.after}}).',
            new_task: true,
            webhook: {
              signature: { header: 'X-Hub-Signature-256', prefix: 'sha256=', secret_ref: ref },
              replay_key: '{{headers.x-github-delivery}}',
            },
          })
        );
        await agent.call('propose_plan', toolPlan(PLAN));
      });
      const taskId = await createTask(world, 'Review every push');
      await until(
        'the secret request',
        () => openGate(world, taskId, (open) => Boolean(open.secret)) !== undefined
      );
      const gate = openGate(world, taskId, (entry) => Boolean(entry.secret)) as Gate;
      expect(gate).toMatchObject({ secret: { label: 'GitHub webhook secret' } });
      const typed = await postJson(world, '/api/commands', {
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'reply',
        response: SECRET,
      });
      expect(typed.status).toBe(400);
      expect((await postJson(world, `/api/secrets/${gate.id}`, { value: SECRET })).status).toBe(200);
      await until('the webhook', () => replies.length === 2);
      expect(replies[0]).toMatch(
        /^The human saved the GitHub webhook secret\. Pass secret-ref:[0-9a-f]{32} /
      );
      const url = /Its URL is (\S+)\. Give/.exec(replies[1] ?? '')?.[1] ?? '';
      expect(url).toStartWith(`${world.shinsa.url}/api/hooks/`);

      const body = JSON.stringify({ ref: 'refs/heads/main', after: 'abc123' });
      const deliver = (headers: Record<string, string>, payload = body) =>
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', host: 'hooks.example.com', ...headers },
          body: payload,
        });
      const forged = await deliver({
        'x-github-delivery': 'd-1',
        'x-hub-signature-256': sign(body, 'guess'),
      });
      expect(forged.status).toBe(401);
      const accepted = await deliver({ 'x-github-delivery': 'd-1', 'x-hub-signature-256': sign(body) });
      expect(accepted.status).toBe(202);
      expect(accepted.headers.get('x-shinsa-hook-outcome')).toBe('accepted');
      const replay = await deliver({ 'x-github-delivery': 'd-1', 'x-hub-signature-256': sign(body) });
      expect((await replay.json()) as Record<string, unknown>).toMatchObject({ outcome: 'duplicate' });
      const tampered = await deliver(
        { 'x-github-delivery': 'd-2', 'x-hub-signature-256': sign(body) },
        body.replace('abc123', 'evil')
      );
      expect(tampered.status).toBe(401);

      const schedule = Object.values(world.shinsa.engine.state.schedules)[0];
      const hooked = tasksFrom(world, schedule?.id ?? '');
      expect(hooked).toHaveLength(1);
      expect(hooked[0]?.request).toMatch(
        /^Review the push to <webhook-data-[0-9a-f]+>refs\/heads\/main<\/webhook-data-[0-9a-f]+>/
      );

      await until('the agents to settle', () => listOpenGates(world.shinsa.engine.state, taskId).length > 0);
      await world.shinsa.engine.settle();
      expect(readEverything(world.dataDir)).not.toContain(SECRET);
      expect(JSON.stringify(world.shinsa.engine.state)).not.toContain(SECRET);
      expect(readFileSync(join(world.dataDir, 'secrets.json'), 'utf8')).toContain(SECRET);
    });
  });
});
