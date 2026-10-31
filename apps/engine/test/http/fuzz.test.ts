import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { MERGE_METHODS, PLAN_APPROVALS, PRIORITY_RANK, replayEventLog, type ShinsaState } from '@shinsa/core';
import { type ModelSource, Transcripts } from '../../src/agents/index.ts';
import { startServer } from '../../src/http/index.ts';
import { Engine } from '../../src/runtime/index.ts';
import { EventLog, EvidenceStore } from '../../src/store/index.ts';
import { createTempDir, createTestConfig, createTestOnboarding, until } from '../helpers/index.ts';
import { createRandom } from '../helpers/random.ts';

setDefaultTimeout(60_000);

const SEEDS = Number(Bun.env.FUZZ_SEEDS ?? 3);

const STEPS = Number(Bun.env.FUZZ_STEPS ?? 150);

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
});

type Random = ReturnType<typeof createRandom>;

const NASTY: unknown[] = [
  null,
  0,
  -1,
  1.5,
  1e308,
  true,
  false,
  '',
  ' ',
  'normal',
  'x'.repeat(20_000),
  '../../../etc/passwd',
  '--upload-pack=touch /tmp/pwned',
  '-rf',
  '\u0000',
  'ünïcödé 🎉',
  '<script>alert(1)</script>',
  [],
  [1, 'a', null],
  {},
  { nested: { deeper: [1, 2] } },
  JSON.parse('{"__proto__": {"polluted": true}}'),
  { constructor: { prototype: { polluted: true } } },
];

const COMMAND_TYPES = [
  'repo.register',
  'repo.update',
  'repo.remove',
  'project.write',
  'project.remove',
  'focus.change',
  'settings.change',
  'task.create',
  'task.prioritize',
  'task.wait_on',
  'task.cancel',
  'task.complete',
  'task.retry',
  'task.message',
  'gate.answer',
  'run.end',
  'agent.note',
  'runs.dispatch',
  'pull_request.record',
  'nope',
];

const FIELDS = [
  'request',
  'repoId',
  'priority',
  'planFirst',
  'origin',
  'waitsOn',
  'taskId',
  'text',
  'gateId',
  'decision',
  'response',
  'patch',
  'project',
  'projectId',
  'until',
  'repo',
  'projectName',
  'runId',
];

const PATCH_FIELDS = [
  'mergeMethod',
  'maxFixRounds',
  'delegationLimit',
  'attentionLimit',
  'approvePlans',
  'defaultModel',
  'defaultProvider',
  'agentModels',
  'worktreesDirectory',
  'checkCommands',
  'defaultBranch',
  'name',
  'projectId',
  'seq',
  'tasks',
];

function listIds(state: ShinsaState) {
  return [
    ...Object.keys(state.tasks),
    ...Object.keys(state.gates),
    ...Object.keys(state.repos),
    ...Object.keys(state.projects),
    ...Object.keys(state.runs),
  ];
}

function createValue(random: Random, state: ShinsaState): unknown {
  const ids = listIds(state);
  if (ids.length > 0 && random.chance(0.3)) return random.pick(ids);
  if (random.chance(0.15))
    return random.pick(['urgent', 'high', 'normal', 'low', 'approve', 'revise', 'answer']);
  return random.pick(NASTY);
}

function createPatch(random: Random, state: ShinsaState) {
  const patch: Record<string, unknown> = {};
  const count = 1 + Math.floor(random.next() * 3);
  for (let index = 0; index < count; index += 1) {
    const field = random.pick(PATCH_FIELDS);
    patch[field] = random.chance(0.3)
      ? random.pick(['squash', 'merge', 'rebase', 'evil', 3, ['bun test'], { builder: 'opus' }])
      : createValue(random, state);
  }
  return patch;
}

function createCommand(random: Random, state: ShinsaState): unknown {
  if (random.chance(0.05)) return random.pick(NASTY);
  const command: Record<string, unknown> = { type: random.pick(COMMAND_TYPES) };
  const count = Math.floor(random.next() * 6);
  for (let index = 0; index < count; index += 1) {
    const field = random.pick(FIELDS);
    command[field] =
      field === 'patch' || field === 'project' || field === 'repo'
        ? createPatch(random, state)
        : createValue(random, state);
  }
  if (random.chance(0.4)) {
    command.type = 'task.create';
    command.request ??= random.chance(0.7) ? 'Fix the login page' : createValue(random, state);
    if (random.chance(0.5)) command.repoId = null;
  }
  return command;
}

const PATHS = [
  '/api/commands',
  '/api/commands',
  '/api/commands',
  '/api/onboarding/setup',
  '/api/onboarding/complete',
  '/api/onboarding/flow',
  '/api/tasks/%2e%2e/blob?path=../../etc/passwd',
  '/api/tasks/x/search?q=%00&glob=-x',
  '/api/tasks/x/open',
  '/api/evidence/..%2Fconfig.json',
  '/api/evidence/%00',
  '/api/queue',
  '/api/nope',
  '/api/../api/queue',
];

function createBody(random: Random, state: ShinsaState) {
  const roll = random.next();
  if (roll < 0.05) return '{"type": "task.create", "request": ';
  if (roll < 0.08) return '\u0000\u0001garbage';
  if (roll < 0.1) return '';
  return JSON.stringify(createCommand(random, state));
}

function assertWellFormed(state: ShinsaState) {
  expect(MERGE_METHODS.has(state.settings.mergeMethod)).toBe(true);
  expect(state.settings.maxFixRounds === null || Number.isInteger(state.settings.maxFixRounds)).toBe(true);
  expect(Number.isInteger(state.settings.delegationLimit ?? 1)).toBe(true);
  expect(Number.isInteger(state.settings.attentionLimit ?? 1)).toBe(true);
  expect(PLAN_APPROVALS.has(state.settings.approvePlans ?? 'when_asked')).toBe(true);
  expect(state.settings.defaultModel === null || typeof state.settings.defaultModel === 'string').toBe(true);
  expect(typeof state.settings.defaultProvider).toBe('string');
  expect('worktreesDirectory' in state.settings).toBe(false);
  for (const model of Object.values(state.settings.agentModels ?? {})) expect(typeof model).toBe('string');
  expect(state.focus.until === null || typeof state.focus.until === 'number').toBe(true);
  expect(state.focus.projectId === null || state.projects[state.focus.projectId] !== undefined).toBe(true);
  for (const project of Object.values(state.projects)) {
    expect(typeof project.name).toBe('string');
    expect(typeof project.color).toBe('string');
    expect(typeof project.key).toBe('string');
    expect(Array.isArray(project.folders)).toBe(true);
  }
  for (const repo of Object.values(state.repos)) {
    expect(typeof repo.name).toBe('string');
    expect(typeof repo.defaultBranch).toBe('string');
    expect(Array.isArray(repo.checkCommands) && repo.checkCommands.every((c) => typeof c === 'string')).toBe(
      true
    );
    expect(repo.projectId === null || typeof repo.projectId === 'string').toBe(true);
  }
  for (const task of Object.values(state.tasks)) {
    expect(typeof task.request).toBe('string');
    expect(typeof task.title).toBe('string');
    expect(PRIORITY_RANK[task.priority]).toBeNumber();
    expect(typeof task.planFirst).toBe('boolean');
    expect(task.origin === null || typeof task.origin === 'string').toBe(true);
    expect(task.repoId === null || state.repos[task.repoId] !== undefined).toBe(true);
    for (const id of task.waitsOn) expect(state.tasks[id]).toBeDefined();
  }
  for (const gate of Object.values(state.gates)) {
    expect(gate.response === null || typeof gate.response === 'string').toBe(true);
  }
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
}

async function startFuzzServer() {
  const root = createTempDir();
  const config = createTestConfig(root, { roots: [] });
  mkdirSync(join(root, 'web'), { recursive: true });
  const engine = new Engine(new EventLog(config.databasePath));
  const http = startServer({
    engine,
    config,
    transcripts: new Transcripts(config.transcriptsDir),
    evidence: new EvidenceStore(config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as ModelSource,
    onboarding: createTestOnboarding(engine, config).onboarding,
  });
  stops.push(http.stop);
  return { config, engine, base: `http://127.0.0.1:${http.server.port}` };
}

type SocketMessage = { type: string; id?: unknown; error?: unknown };

async function waitForAck(messages: SocketMessage[], id: string) {
  const find = () => messages.find((message) => message.type === 'ack' && message.id === id);
  await until(`the ack for ${id}`, () => find() !== undefined);
  return find() as SocketMessage;
}

interface SocketStep {
  socket: WebSocket;
  random: Random;
  engine: Engine;
  messages: SocketMessage[];
  step: number;
}

async function sendCommandMessage({ socket, random, engine, messages, step }: SocketStep) {
  const before = engine.state.seq;
  const id = random.chance(0.8) ? `c${step}` : createValue(random, engine.state);
  socket.send(JSON.stringify({ type: 'command', id, command: createCommand(random, engine.state) }));
  if (typeof id === 'string' && id.length > 0 && id.length <= 200) {
    const ack = await waitForAck(messages, id);
    if (ack.error) expect(engine.state.seq).toBe(before);
    return;
  }
  const probe = `probe-${step}`;
  socket.send(JSON.stringify({ type: 'command', id: probe, command: { type: 'probe' } }));
  expect((await waitForAck(messages, probe)).error).toBeTruthy();
  expect(engine.state.seq).toBe(before);
}

async function sendRandomMessage(context: SocketStep) {
  const { socket, random, engine } = context;
  const roll = random.next();
  if (roll < 0.1) socket.send('not json');
  else if (roll < 0.2) socket.send(JSON.stringify(random.pick(NASTY)));
  else if (roll < 0.3) {
    const type = random.pick(['transcript.subscribe', 'transcript.unsubscribe']);
    socket.send(JSON.stringify({ type, runId: createValue(random, engine.state) }));
  } else await sendCommandMessage(context);
}

const ALLOWED_STATUSES = new Set([200, 400, 403, 404, 415]);

describe('fuzzing the command surface', () => {
  for (let seed = 1; seed <= SEEDS; seed += 1) {
    test(`seed ${seed}: malformed HTTP requests never break the server or the event log`, async () => {
      const random = createRandom(seed * 7919);
      const { engine, base, config } = await startFuzzServer();
      await engine.dispatch({ type: 'task.create', request: 'Seed a task', repoId: null });
      for (let step = 0; step < STEPS; step += 1) {
        const path = random.pick(PATHS);
        const body = createBody(random, engine.state);
        const before = engine.state.seq;
        const method = random.chance(0.9) ? 'POST' : random.pick(['GET', 'PUT', 'DELETE', 'PATCH']);
        const response = await fetch(`${base}${path}`, {
          method,
          headers: { 'content-type': random.chance(0.95) ? 'application/json' : 'text/plain' },
          ...(method === 'GET' ? {} : { body }),
        });
        const label = `seed ${seed} step ${step}: ${path} ${body.slice(0, 300)}`;
        expect({ label, status: ALLOWED_STATUSES.has(response.status) }).toEqual({ label, status: true });
        const text = await response.text();
        if (path.startsWith('/api/commands') && response.status !== 200) {
          expect({ label, seq: engine.state.seq }).toEqual({ label, seq: before });
          expect({ label, json: () => JSON.parse(text) }.json()).toHaveProperty('error');
        }
        assertWellFormed(engine.state);
      }
      const reopened = new EventLog(config.databasePath);
      const read = reopened.readEvents();
      reopened.close();
      expect(read.unreadable).toEqual([]);
      const replayed = replayEventLog(read.events);
      expect(replayed.failures).toEqual([]);
      expect(JSON.parse(JSON.stringify(replayed.state))).toEqual(JSON.parse(JSON.stringify(engine.state)));
      const ok = await fetch(`${base}/api/commands`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'task.create', request: 'Still works', repoId: null }),
      });
      expect(ok.status).toBe(200);
    });
  }

  test('malformed WebSocket messages are answered or ignored, and the socket stays usable', async () => {
    const random = createRandom(4242);
    const { engine, base } = await startFuzzServer();
    const socket = new WebSocket(`${base.replace('http', 'ws')}/ws`, {
      headers: { origin: base },
    });
    const messages: SocketMessage[] = [];
    socket.addEventListener('message', (event) => messages.push(JSON.parse(String(event.data))));
    await new Promise((resolve) => socket.addEventListener('open', resolve));
    for (let step = 0; step < STEPS; step += 1) {
      await sendRandomMessage({ socket, random, engine, messages, step });
      assertWellFormed(engine.state);
    }
    socket.send(
      JSON.stringify({
        type: 'command',
        id: 'last',
        command: { type: 'task.create', request: 'Still works', repoId: null },
      })
    );
    expect(await waitForAck(messages, 'last')).toEqual({ type: 'ack', id: 'last', error: null });
    socket.close();
  });
});
