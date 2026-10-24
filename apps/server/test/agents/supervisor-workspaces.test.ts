import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ShinsaState } from '@shinsa/core';
import { RunSupervisor, Transcripts } from '../../src/agents/index.ts';
import type {
  AgentSession,
  AgentSessionInput,
  AgentSessionResult,
} from '../../src/agents/providers/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { Workspaces } from '../../src/workspaces/index.ts';
import { createGitRepo, createTempDir, createTestConfig, git, until, writeFiles } from '../helpers/index.ts';
import { createRepo, createRun, createStubEngine, createTask } from '../helpers/state.ts';

interface Started {
  input: AgentSessionInput;
  finish: () => void;
}

function createSessions() {
  const started: Started[] = [];
  const startSession = (input: AgentSessionInput): AgentSession => {
    const done = Promise.withResolvers<AgentSessionResult>();
    started.push({ input, finish: () => done.resolve({ outcome: 'completed', summary: 'done' }) });
    return {
      done: done.promise,
      steer: () => true,
      cancel: () => {
        done.resolve({ outcome: 'cancelled', summary: null });
        return Promise.resolve();
      },
    };
  };
  return { started, startSession };
}

async function setup(dataDir = createTempDir()) {
  const { repo, path } = await createGitRepo({ files: { 'a.txt': 'a\n' } });
  await runCommandOrThrow(['but', 'setup', '--json'], path);
  const workspaces = new Workspaces({ dataDir, worktreesDir: createTempDir() });
  const sessions = createSessions();
  const butler = createRepo({ path, workspace: 'gitbutler' });
  const stub = createStubEngine((state: ShinsaState) => {
    state.repos['repo-1'] = butler;
    for (const [id, branch] of [
      ['task-1', 'fix/scroll'],
      ['task-2', 'feat/banner'],
      ['task-3', 'docs/readme'],
    ] as const) {
      state.tasks[id] = createTask({ id, branch, worktreePath: path, workspace: 'gitbutler' });
    }
    state.runs['run-1'] = createRun({ id: 'run-1', taskId: 'task-1' });
    state.runs['run-2'] = createRun({ id: 'run-2', taskId: 'task-2' });
    state.runs['run-3'] = createRun({ id: 'run-3', taskId: 'task-3', purpose: 'plan' });
  });
  for (const branch of ['fix/scroll', 'feat/banner', 'docs/readme']) {
    await runCommandOrThrow(['but', 'branch', 'new', branch, '--json'], path);
  }
  const config = createTestConfig();
  const supervisor = new RunSupervisor(
    stub.engine,
    config,
    new Transcripts(config.transcriptsDir),
    new EvidenceStore(config.evidenceDir),
    { startSession: sessions.startSession, workspaces }
  );
  return { ...stub, repo, path, sessions, supervisor, workspaces };
}

describe('agents in a GitButler workspace', () => {
  test('one agent that changes files at a time; an agent that is planning never waits', async () => {
    const { supervisor, sessions } = await setup();
    const first = supervisor.execute('run-1');
    await until('the first builder', () => sessions.started.length === 1);
    const second = supervisor.execute('run-2');
    const reviewer = supervisor.execute('run-3');
    await until('the planning agent', () => sessions.started.length === 2);
    expect(sessions.started.map((started) => started.input.readOnly)).toEqual([false, true]);
    sessions.started[1]?.finish();
    await reviewer;
    sessions.started[0]?.finish();
    await first;
    await until('the second builder', () => sessions.started.length === 3);
    sessions.started[2]?.finish();
    await second;
  });

  test('a waiting agent that is cancelled never starts, and shutdown stops every wait', async () => {
    const { supervisor, sessions, dispatched } = await setup();
    const first = supervisor.execute('run-1');
    await until('the first builder', () => sessions.started.length === 1);
    const second = supervisor.execute('run-2');
    await Bun.sleep(10);
    await supervisor.cancel('run-2');
    await second;
    expect(sessions.started).toHaveLength(1);
    expect(dispatched.filter((command) => command.type === 'run.end')).toEqual([]);
    const third = supervisor.execute('run-2');
    await Bun.sleep(10);
    await supervisor.interruptForShutdown();
    await Promise.all([first, third]);
    expect(sessions.started).toHaveLength(1);
  });

  test('a phase is committed to the task’s own branch, leaving the other task’s edits alone', async () => {
    const { supervisor, sessions, path } = await setup();
    const running = supervisor.execute('run-1');
    await until('the builder', () => sessions.started.length === 1);
    writeFiles(path, { 'a.txt': 'a, fixed\n' });
    const started = sessions.started[0] as Started;
    await started.input.tools.handle(
      'complete_phase',
      { summary: 'Fixed `a.txt`.', spots: [], judgement_calls: [] },
      new AbortController().signal
    );
    started.finish();
    await running;
    expect(await git(path, 'show', 'fix/scroll:a.txt')).toBe('a, fixed');
    expect(await git(path, 'rev-parse', 'feat/banner')).toBe(await git(path, 'rev-parse', 'main'));
    expect(await git(path, 'status', '--porcelain')).toBe('');
  });

  test('a phase that changes lines another task’s branch changed stacks on it and tells core', async () => {
    const { supervisor, sessions, path, dispatched } = await setup();
    const handOver = async (runId: string, index: number, files: Record<string, string>) => {
      const running = supervisor.execute(runId);
      await until('the builder', () => sessions.started.length === index + 1);
      writeFiles(path, files);
      const started = sessions.started[index] as Started;
      await started.input.tools.handle(
        'complete_phase',
        { summary: 'Changed `a.txt`.', spots: [], judgement_calls: [] },
        new AbortController().signal
      );
      started.finish();
      await running;
    };
    await handOver('run-1', 0, { 'a.txt': 'a, fixed\n' });
    await handOver('run-2', 1, { 'a.txt': 'a, fixed\nand more\n' });
    const types = dispatched.map((command) => command.type);
    expect(dispatched.filter((command) => command.type === 'task.stack')).toEqual([
      { type: 'task.stack', taskId: 'task-2', branch: 'fix/scroll' },
    ]);
    expect(types.lastIndexOf('agent.complete_phase')).toBeGreaterThan(types.indexOf('task.stack'));
    expect(await git(path, 'show', 'feat/banner:a.txt')).toBe('a, fixed\nand more');
  });

  test('a claim that cannot be recorded fails the run instead of letting it write unclaimed', async () => {
    const blocked = join(createTempDir(), 'file');
    writeFileSync(blocked, 'not a folder');
    const { supervisor, sessions, dispatched } = await setup(blocked);
    await supervisor.execute('run-1');
    expect(sessions.started).toHaveLength(0);
    expect(dispatched.find((command) => command.type === 'run.end')).toMatchObject({
      runId: 'run-1',
      outcome: 'failed',
      summary: expect.stringContaining('Shinsa could not claim the checkout for this agent:'),
    });
  });
});
