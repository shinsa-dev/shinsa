import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { type MessageKind, resolveTaskRounds, type TaskShape } from '@shinsa/core';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import { resolveCommandVerdict } from '../../src/agents/providers/claude/guard.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { type CliIo, runCli } from '../../src/cli/index.ts';
import { startServer } from '../../src/http/index.ts';
import { createProjectChanges } from '../../src/projects/routes.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createClassifier, createCommandRouter } from '../../src/triage/message.ts';
import { createTestOnboarding } from '../helpers/index.ts';
import { type AgentContext, World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await world?.dispose();
  world = null;
});

const address = { url: '' };

function answerAs(kind: MessageKind, title: string): QuickJson {
  return <T>() => Promise.resolve({ kind, shape: 'change', title, why: `It reads as ${kind}.` } as T);
}

async function open(ask: QuickJson = answerAs('feedback', 'Keep going')) {
  world = await World.create({
    supervise: (_, engine) => ({
      manage: {
        baseUrl: () => address.url,
        projects: createProjectChanges({
          engine,
          resolveLogin: () => Promise.resolve(null),
          userHome: world?.config.userHome ?? '',
        }),
        route: createCommandRouter(engine, createClassifier(ask)),
      },
    }),
  });
  const w = world;
  const http = startServer({
    engine: w.engine,
    config: w.config,
    transcripts: new Transcripts(w.config.transcriptsDir),
    evidence: new EvidenceStore(w.config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding: createTestOnboarding(w.engine, w.config).onboarding,
  });
  address.url = http.url;
  stops.push(() => http.stop());
  return w;
}

async function shinsa(...args: string[]) {
  const out: string[] = [];
  const io: CliIo = {
    env: { SHINSA_PORT: new URL(address.url).port, SHINSA_HOME: world?.config.home },
    cwd: '/code/app',
    write: (line = '') => out.push(line),
    writeError: (line) => out.push(line),
    openUrl: () => Promise.resolve(),
    serve: () => Promise.reject(new Error('not in this test')),
    onShutdown: () => undefined,
  };
  expect(await runCli(args, io)).toBe(0);
  return out.join('\n');
}

function createShapedTask(w: World, request: string, shape: TaskShape) {
  return w.createTask(request, { shape });
}

const HUMAN_ONLY_TOOLS = [
  'plans_approve',
  'plans_revise',
  'plans_reject',
  'reviews_approve',
  'reviews_revise',
  'reviews_reject',
  'reviews_verdicts',
  'merges_approve',
  'merges_reject',
  'operations_run',
  'operations_finish',
  'gates_answer',
  'gates_secret',
  'gates_decline_secret',
  'questions_answer',
  'accounts_sign_in',
  'accounts_sign_in_code',
  'mcp_sign_in',
  'command',
];

const HUMAN_ONLY_COMMANDS = [
  'shinsa plans approve SW-1',
  'shinsa reviews approve SW-1',
  'shinsa reviews verdicts SW-1 --dismiss 0',
  'cd /code/app && shinsa merges approve SW-1 --json',
  'shinsa operations run SW-1',
  'shinsa gates answer gate-1 --decision approve',
  'shinsa questions answer SW-1 Yes',
  'shinsa gates secret gate-1 hunter2',
  'shinsa accounts sign-in',
  'shinsa command gate.answer --fields \'{"gateId":"gate-1","decision":"approve"}\'',
];

async function attempt(agent: AgentContext, name: string, input: Record<string, unknown>) {
  try {
    return { text: await agent.call(name, input), code: null };
  } catch (error) {
    return { text: (error as Error).message, code: (error as { code?: string }).code ?? null };
  }
}

function handleOf(w: World, taskId: string) {
  return w.task(taskId).handle ?? taskId;
}

async function reachMergeGate(w: World) {
  const taskId = await w.createTask('Fix the paywall');
  await w.answer(await w.untilGate(taskId, 'review'), 'approve');
  await w.until('the pull request to open', () => w.github.pulls.length === 1);
  w.github.update(1, { checks: 'passing' });
  await w.sync(taskId);
  await w.untilGate(taskId, 'merge');
  return taskId;
}

describe('every task agent manages Shinsa', () => {
  test('an agent completes its own task on your behalf, and nothing is left running', async () => {
    const w = await open();
    let taskId = '';
    const replies: { text: string; code: string | null }[] = [];
    w.agents.queue('answerer', async (agent) => {
      replies.push(await attempt(agent, 'tasks_done', { task: handleOf(w, taskId) }));
    });
    taskId = await createShapedTask(w, 'Is the greeting still needed?', 'answer');
    await w.untilStage(taskId, 'done');
    await w.until('the answerer to stop', () => w.activeRuns(taskId).length === 0);
    expect(['Marked as done. Stop here without a closing message.', 'cancelled']).toContain(
      replies[0]?.text ?? ''
    );
    expect(w.gates(taskId)).toEqual([]);
    expect(Object.values(w.state.runs).find((run) => run.taskId === taskId)?.outcome).toBe('cancelled');
    expect(w.state.onBehalfActions?.map((action) => action.byTaskId)).toEqual([taskId]);
    const shown = await shinsa('activity');
    expect(shown).toMatch(
      new RegExp(
        `Marked “Is the greeting still needed\\?” as done  \\(the agent of ${handleOf(w, taskId)}\\)$`
      )
    );
  });

  test('an agent has no tool and no command for a decision only the human makes', async () => {
    const w = await open();
    const fixId = await reachMergeGate(w);
    const reviewId = await w.createTask('Tidy the logs');
    const review = await w.untilGate(reviewId, 'review');
    let tools: string[] = [];
    const calls: Record<string, { text: string; code: string | null }> = {};
    w.agents.queue('answerer', async (agent) => {
      tools = await agent.listTools();
      for (const name of HUMAN_ONLY_TOOLS) {
        calls[name] = await attempt(agent, name, { task: fixId, gate: review.id, decision: 'approve' });
      }
      calls.tasks_create = await attempt(agent, 'tasks_create', { request: 'Merge the paywall fix' });
      await agent.call('answer', { answer: 'Both wait for you at their gates.' });
    });
    const askId = await createShapedTask(w, 'Please merge the paywall fix and approve the logs.', 'answer');
    await w.untilStage(askId, 'done');

    expect(tools).toContain('tasks_prioritize');
    expect(tools).toContain('create_task');
    expect(tools).not.toContain('tasks_create');
    expect(tools.filter((name) => HUMAN_ONLY_TOOLS.includes(name))).toEqual([]);
    for (const name of [...HUMAN_ONLY_TOOLS, 'tasks_create'])
      expect(calls[name]?.text).toBe(`Unknown tool ${name}.`);
    for (const command of HUMAN_ONLY_COMMANDS) {
      expect({ command, verdict: resolveCommandVerdict(command, 'main') }).toEqual({
        command,
        verdict: {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: expect.stringContaining('it waits for them in Shinsa'),
          },
        },
      });
    }
    expect(resolveCommandVerdict('shinsa tasks list', 'main')).toEqual({});
    expect(w.task(fixId).stage).toBe('awaiting_merge');
    expect(w.task(reviewId).stage).toBe('awaiting_review');
    expect(w.state.gates[review.id]?.status).toBe('open');
    expect(w.state.onBehalfActions ?? []).toEqual([]);
    expect(w.github.pulls[0]?.state).toBe('OPEN');
  });

  test('an agent changes another task’s priority, logged as its task, and a repeated call applies once', async () => {
    const w = await open();
    const otherId = await w.createTask('Tidy the logs', { priority: 'low' });
    let saved: AgentContext | null = null;
    w.agents.queue('answerer', async (agent) => {
      saved = agent;
      await agent.call('tasks_prioritize', { task: otherId, priority: 'urgent' }, 'r1');
      await agent.call('tasks_prioritize', { task: otherId, priority: 'urgent' }, 'r1');
      await agent.call('answer', { answer: 'Raised it.' });
    });
    const askId = await createShapedTask(w, 'Make the log task urgent', 'answer');
    await w.untilStage(askId, 'done');
    const run = Object.values(w.state.runs).find((candidate) => candidate.taskId === askId);
    const id = `agent:${run?.id}:${run?.attemptId}:call:r1:1`;
    expect(w.daemon.log.selectReceipt(id)).toMatchObject({ type: 'task.prioritize', status: 'accepted' });
    expect(w.task(otherId).priority).toBe('urgent');
    const changes = w.daemon.log.readEvents().events.filter((event) => event.type === 'task.prioritized');
    expect(changes).toEqual([expect.objectContaining({ taskId: otherId, onBehalf: true, byTask: askId })]);
    expect(w.state.onBehalfActions).toEqual([
      expect.objectContaining({ command: 'task.prioritize', taskId: otherId, byTaskId: askId }),
    ]);
    expect((saved as AgentContext | null)?.call('tasks_list', {})).rejects.toThrow(
      'This step is already over. End your turn.'
    );
  });

  test('a message an agent sends without saying what it is gets classified like yours, on your behalf', async () => {
    const w = await open(answerAs('new_round', 'Add search'));
    const otherId = await w.createTask('Add the settings screen');
    await w.until('the planner', () => w.agents.of('planner').length === 1);
    w.agents.queue('answerer', async (agent) => {
      await agent.call('tasks_message', { task: otherId, text: 'Then add search' });
      await agent.call('answer', { answer: 'Asked for search.' });
    });
    const askId = await createShapedTask(w, 'Ask the settings task for search', 'answer');
    await w.untilStage(askId, 'done');
    expect(resolveTaskRounds(w.task(otherId)).map((round) => [round.title, round.status])).toEqual([
      ['Add the settings screen', 'active'],
      ['Add search', 'waiting'],
    ]);
    expect(w.state.onBehalfActions).toEqual([
      expect.objectContaining({ command: 'task.message', taskId: otherId, byTaskId: askId }),
    ]);
  });

  test('a folder an agent adds to a project is recorded on your behalf', async () => {
    const w = await open();
    const folder = join(w.config.userHome, 'basket');
    mkdirSync(folder, { recursive: true });
    await w.engine.dispatch({ type: 'project.write', project: { name: 'Basket', color: 'blue' } });
    const projectId = Object.keys(w.state.projects)[0] ?? '';
    w.agents.queue('answerer', async (agent) => {
      await agent.call('projects_add_folder', { project: projectId, path: folder });
      await agent.call('answer', { answer: 'Added it.' });
    });
    const askId = await createShapedTask(w, 'Add the basket folder', 'answer');
    await w.untilStage(askId, 'done');
    expect(w.state.projects[projectId]?.folders).toEqual([realpathSync(folder)]);
    expect(w.state.onBehalfActions).toEqual([expect.objectContaining({ byTaskId: askId })]);
  });
});
