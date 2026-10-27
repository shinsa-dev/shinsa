import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Gate, listOpenGates } from '@shinsa/core';
import { resolveCompactionWindow } from '../../src/agents/compaction.ts';
import type { ModelSource } from '../../src/agents/index.ts';
import { CLAUDE_CAPABILITIES } from '../../src/agents/providers/claude/index.ts';
import { type AgentProvider, type AgentSession, ProviderRegistry } from '../../src/agents/providers/index.ts';
import { inspectRepo } from '../../src/git/index.ts';
import { type Shinsa, startShinsa } from '../../src/serve.ts';
import { createGitRepo, createTempDir, createTestConfig, until } from '../helpers/index.ts';
import { FakeAgents, PLAN, toolPlan } from './harness.ts';

setDefaultTimeout(30_000);

const MINUTE = 60_000;

const HOUR = 60 * MINUTE;

const models = { listModels: () => Promise.resolve([]) } as unknown as ModelSource;

interface Boot {
  shinsa: Shinsa;
  agents: FakeAgents;
  repoId: string;
  dataDir: string;
  compactions: string[];
}

function createProvider(agents: FakeAgents, compactions: string[]): AgentProvider {
  const base = agents.provider('claude', 'Claude');
  return {
    ...base,
    capabilities: { ...CLAUDE_CAPABILITIES, compaction: true },
    startSession: (input) => {
      const session = base.startSession(input);
      const context = {
        usedTokens: 170_000,
        maxTokens: 200_000,
        cacheExpiresAt: Date.now() + 2 * MINUTE + 150,
        backgroundWork: false,
      };
      return { ...session, done: session.done.then((result) => ({ ...result, context })) };
    },
    compactSession: (input): AgentSession => {
      compactions.push(input.resume ?? '');
      input.onEntry({
        type: 'notice',
        notice: { kind: 'compaction', trigger: 'manual', preTokens: 150_000, summary: null },
      });
      input.onEntry({ type: 'agent', phase: 'final', text: 'Compacted.' });
      const usage = {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 150_000,
        cacheWriteTokens: 0,
        costUsd: 0.05,
      };
      return {
        done: Promise.resolve({ outcome: 'completed', summary: null, usage }),
        steer: () => false,
        cancel: () => Promise.resolve(),
      };
    },
  };
}

async function boot(options: { idleMs?: number; compaction?: boolean }): Promise<Boot> {
  const repo = await createGitRepo();
  const config = createTestConfig(createTempDir(), { roots: [repo.root] });
  const agents = new FakeAgents();
  const compactions: string[] = [];
  const shinsa = await startShinsa(config, {
    models,
    resolveLogin: () => Promise.resolve(null),
    providers: new ProviderRegistry([createProvider(agents, compactions)]),
    triage: (_state, task) =>
      Promise.resolve({
        title: task.request.split('\n')[0]?.slice(0, 40) ?? 'Task',
        repoPath: repo.path,
        size: 'small',
        branch: `feat/t-${task.id.slice(-8)}`,
        waitsOn: [],
      }),
    ...(options.idleMs ? { idle: { idleMs: options.idleMs } } : {}),
  });
  if (options.compaction) {
    await shinsa.engine.dispatch({
      type: 'settings.change',
      patch: { compaction: 'claude', idleCompaction: true },
    });
  }
  agents.state = () => shinsa.engine.state;
  const candidate = await inspectRepo(repo.path);
  await shinsa.engine.dispatch({
    type: 'repo.register',
    repo: { ...candidate, checkCommands: ['true'] },
    projectName: null,
  });
  const repoId = Object.keys(shinsa.engine.state.repos)[0] ?? '';
  return { shinsa, agents, repoId, dataDir: config.dataDir, compactions };
}

async function withWorld(
  options: { idleMs?: number; compaction?: boolean },
  body: (world: Boot) => Promise<void>
) {
  const world = await boot(options);
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

function openGate(world: Boot, taskId: string, predicate: (gate: Gate) => boolean) {
  return listOpenGates(world.shinsa.engine.state, taskId).find(predicate);
}

describe('idle sessions, end to end', () => {
  test('a session waiting too long on an answer is released, and the answer resumes the same session', async () => {
    await withWorld({ idleMs: 30 }, async (world) => {
      world.agents.queue('plan', async (agent) => {
        const answer = await agent.call('ask', { question: 'Blue or green?' });
        throw new Error(`should have been released, got ${answer}`);
      });
      world.agents.queue('plan', async (agent) => {
        expect(agent.resumed).toBe(true);
        expect(agent.prompt).toContain('green');
        await agent.call('propose_plan', toolPlan(PLAN));
      });
      const taskId = await createTask(world, 'Paint it');
      await until(
        'the question',
        () => openGate(world, taskId, (open) => open.type === 'question') !== undefined
      );
      await until('the release', () => world.agents.sessions[0]?.cancelled === true);
      const asker = Object.values(world.shinsa.engine.state.runs).find((run) => run.purpose === 'plan');
      expect(asker?.endedAt).toBeNull();
      const gate = openGate(world, taskId, (entry) => entry.type === 'question') as Gate;
      await world.shinsa.engine.dispatch({
        type: 'gate.answer',
        gateId: gate.id,
        decision: 'reply',
        response: 'green',
      });
      await until('the resumed planner', () => world.agents.of('plan').length === 2);
      expect(world.agents.of('plan')[1]?.resume).toBe(world.agents.of('plan')[0]?.sessionId);
      await until('building', () => world.shinsa.engine.state.tasks[taskId]?.stage !== 'planning');
    });
  });

  test('the round agent’s large session is compacted once after its last phase, two minutes before its cache expires', async () => {
    await withWorld({ compaction: true }, async (world) => {
      const taskId = await createTask(world, 'Build the greeting');
      await until(
        'the review gate',
        () => openGate(world, taskId, (gate) => gate.type === 'review') !== undefined,
        30_000
      );
      await until('the compaction', () => world.compactions.length === 1);
      const builder = Object.values(world.shinsa.engine.state.runs)
        .filter((run) => run.purpose === 'build')
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      expect(world.compactions).toEqual([builder?.sessionId ?? '']);
      await until(
        'the record',
        () => (world.shinsa.engine.state.runs[builder?.id ?? '']?.compactions?.length ?? 0) === 1
      );
      expect(world.shinsa.engine.state.runs[builder?.id ?? '']?.usage?.costUsd).toBeGreaterThan(0);
      const entries = readFileSync(join(world.dataDir, 'transcripts', `${builder?.id}.jsonl`), 'utf8');
      expect(entries).toContain('"kind":"compaction"');
      expect(entries).not.toContain('Compacted.');
      const state = world.shinsa.engine.state;
      const context = {
        usedTokens: 170_000,
        maxTokens: 200_000,
        cacheExpiresAt: Date.now() + HOUR,
        backgroundWork: false,
      };
      const windows = Object.values(state.runs)
        .filter((run) => run.taskId === taskId)
        .map((run) => resolveCompactionWindow(state, run.id, context, Date.now()));
      expect(windows.every((window) => window === null)).toBe(true);
      expect(world.compactions).toHaveLength(1);
    });
  });
});
