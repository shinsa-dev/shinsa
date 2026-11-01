import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { TASK_PRIORITIES, TASK_SHAPES, type TaskShape } from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { AGENT_REPLY, World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

async function open() {
  world = await World.create();
  return world;
}

function createShapedTask(w: World, request: string, shape: TaskShape) {
  return w.createTask(request, { shape });
}

async function listBranchFiles(w: World, branch: string) {
  const files = await runCommandOrThrow(['git', 'ls-tree', '-r', '--name-only', branch], w.repoPath);
  return files.split('\n').filter(Boolean);
}

interface Classified {
  prompt: string;
  schema: JsonSchema | undefined;
}

function classifyAs(w: World, answer: Record<string, unknown>) {
  const asked: Classified[] = [];
  const repo = w.state.repos[w.repoId]?.name ?? '';
  w.classify = <T>(_system: string, prompt: string, schema?: JsonSchema) => {
    asked.push({ prompt, schema });
    return Promise.resolve({ title: 'Why the greetings are missing', repo, size: 'small', ...answer } as T);
  };
  return asked;
}

function listTaskRecord(w: World, taskId: string) {
  const gates = w.daemon.log
    .readEvents()
    .events.filter((event) => event.type === 'gate.opened' && event.gate.taskId === taskId);
  const effects = w.daemon.log
    .listEffectStatuses()
    .filter((effect) => effect.key.includes(taskId))
    .map((effect) => effect.kind);
  return { gates, effects };
}

describe('an inquiry has no verification steps', () => {
  test('an answer and a research task run end to end with no checks, reviews or pull request, and wait for you to close them', async () => {
    const w = await open();
    const answer = await createShapedTask(w, 'Where does the greeting live?', 'answer');
    const research = await createShapedTask(w, 'Compare ways to store the greetings', 'research');
    await w.untilStage(answer, 'answered');
    await w.untilStage(research, 'answered');
    for (const [taskId, step] of [
      [answer, 'answer'],
      [research, 'research'],
    ] as const) {
      expect(w.task(taskId)).toMatchObject({
        pipeline: [step],
        stageReason: step === 'answer' ? 'answered your question' : 'wrote the report',
        checkResults: null,
        plan: null,
        pullRequest: null,
      });
      const { gates, effects } = listTaskRecord(w, taskId);
      expect(gates.map((event) => event.type === 'gate.opened' && event.gate.type)).toEqual(['result']);
      expect(effects).toContain('task.triage');
      expect(effects.filter((kind) => kind === 'checks.run' || kind.startsWith('pull_request.'))).toEqual([]);
    }
    expect(w.agents.sessions.map((session) => session.key).sort()).toEqual(['answerer', 'researcher']);
    expect(w.github.calls).toEqual([]);
    await w.answer(await w.untilGate(answer, 'result'), 'approve');
    await w.untilStage(answer, 'done');
    expect(w.task(answer).stageReason).toBe('closed by you');
  });
});

describe('the shapes a task can take', () => {
  test('a question is answered from the repository itself, and a follow-up goes to the same answerer', async () => {
    const w = await open();
    const taskId = await createShapedTask(w, 'Where does the greeting live?', 'answer');
    await w.untilStage(taskId, 'answered');
    expect(w.task(taskId)).toMatchObject({
      pipeline: ['answer'],
      result: { step: 'answer', body: 'It lives in a.txt.' },
      worktreePath: null,
      branch: null,
      pullRequest: null,
    });
    w.agents.queue('answerer', async (agent) => {
      await agent.call('answer', { answer: 'And b.txt holds the second one.', reply: AGENT_REPLY });
    });
    await w.engine.dispatch({ type: 'task.message', taskId, text: 'And the second greeting?' });
    await w.until(
      'the follow-up answer',
      () => w.task(taskId).result?.body === 'And b.txt holds the second one.'
    );
    await w.untilStage(taskId, 'answered');
    expect(w.task(taskId).iterations?.at(-1)).toMatchObject({
      requests: [{ text: 'And the second greeting?' }],
      reply: { headline: AGENT_REPLY.headline },
    });
    const [first, second] = w.agents.of('answerer');
    expect(first?.cwd).toBe(w.state.repos[w.repoId]?.path ?? '');
    expect(second?.resume).toBe(first?.sessionId ?? '');
    expect(w.agents.sessions.map((session) => session.key)).toEqual(['answerer', 'answerer']);
    expect(w.github.pulls).toEqual([]);
  });

  test('a change is planned, built, checked, reviewed by you and opened as a pull request', async () => {
    const w = await open();
    const taskId = await createShapedTask(w, 'Add the greeting files', 'change');
    await w.answer(await w.untilGate(taskId, 'review'), 'approve');
    await w.until('the pull request', () => w.task(taskId).pullRequest !== null);
    expect(w.task(taskId).pipeline).toEqual([
      'plan',
      'build',
      'checks',
      'agent_review',
      'your_review',
      'pull_request',
      'merge',
    ]);
    expect(w.agents.sessions.map((session) => session.key)).toEqual(['plan', 'build', 'build', 'reviewer']);
    expect(w.github.pulls).toHaveLength(1);
  });

  test('left on Auto, the classifier picks the kind and priority with a reason, and the task takes that shape', async () => {
    const w = await open();
    const asked = classifyAs(w, {
      branch: 'fix/missing-greetings',
      shape: 'investigate',
      shape_why: 'It asks why something is missing, not for a change.',
      priority: 'high',
      priority_why: 'People see the missing greeting today.',
      waits_on: [],
      waits_on_why: 'No open task touches the greetings.',
    });
    const taskId = await w.createTask('Why are the greetings missing?');
    await w.untilStage(taskId, 'answered');
    expect(w.task(taskId)).toMatchObject({
      pipeline: ['investigate'],
      priority: 'high',
      auto: { shape: true, start: true, priority: true },
      triageDecisions: {
        shape: { value: 'investigate', why: 'It asks why something is missing, not for a change.' },
        priority: { value: 'high', why: 'People see the missing greeting today.' },
        start: { value: [], why: 'No open task touches the greetings.' },
      },
      result: { step: 'investigate', body: 'The greeting files were never written.' },
      pullRequest: null,
    });
    const [question] = asked;
    expect(question?.prompt).toContain('- shape (choice): What kind of task is this?');
    expect(question?.schema?.properties).toMatchObject({
      shape: { type: 'string', enum: [...TASK_SHAPES] },
      priority: { type: 'string', enum: [...TASK_PRIORITIES] },
      waits_on: { type: 'array' },
    });
    expect(w.agents.sessions.map((session) => session.key)).toEqual(['investigator']);
  });

  test('an investigation reports its diagnosis, and closing it leaves no worktree and no pull request', async () => {
    const w = await open();
    let worktree = '';
    w.agents.queue('investigator', async (agent) => {
      worktree = agent.cwd;
      agent.write('probe.txt', 'a scratch edit\n');
      await agent.call('report_diagnosis', { diagnosis: 'The greeting files were never written.' });
    });
    const taskId = await createShapedTask(w, 'Find out why the greetings are missing', 'investigate');
    await w.untilStage(taskId, 'answered');
    await w.answer(await w.untilGate(taskId, 'result'), 'approve');
    await w.untilStage(taskId, 'done');
    await w.until('the worktree to go', () => w.task(taskId).worktreePath === null && !existsSync(worktree));
    expect(w.task(taskId)).toMatchObject({
      pipeline: ['investigate'],
      result: { step: 'investigate', body: 'The greeting files were never written.' },
      pullRequest: null,
      plan: null,
    });
    expect(worktree).not.toBe(w.repoPath);
    expect(w.agents.sessions.map((session) => session.key)).toEqual(['investigator']);
    expect(w.github.pulls).toEqual([]);
  });

  test('an investigation whose fix you approve is planned, built and opened as a pull request without its scratch edits', async () => {
    const w = await open();
    w.agents.queue('investigator', async (agent) => {
      agent.write('probe.txt', 'a scratch edit\n');
      await agent.call('report_diagnosis', {
        diagnosis: 'Nothing writes the greeting files.',
        propose_change: { request: 'Write a.txt and b.txt.', why: 'The greetings need both files.' },
      });
    });
    const taskId = await createShapedTask(w, 'Find out why the greetings are missing', 'investigate');
    const gate = await w.untilGate(taskId, 'proposal');
    expect(gate).toMatchObject({
      title: 'Turn this investigation into a fix?',
      body: 'The greetings need both files.\n\nWrite a.txt and b.txt.',
    });
    expect(w.task(taskId).stage).toBe('awaiting_proposal');
    await w.answer(gate, 'approve');
    await w.answer(await w.untilGate(taskId, 'review'), 'approve');
    await w.until('the pull request', () => w.task(taskId).pullRequest !== null);
    const task = w.task(taskId);
    expect(task.pipeline?.[0]).toBe('investigate');
    expect(task.pipeline).toContain('pull_request');
    const files = await listBranchFiles(w, task.branch ?? '');
    expect(files).toEqual(expect.arrayContaining(['a.txt', 'b.txt']));
    expect(files).not.toContain('probe.txt');
    expect(await runCommandOrThrow(['git', 'stash', 'list'], w.repoPath)).toBe('');
    expect(w.agents.sessions.map((session) => session.key).slice(0, 2)).toEqual(['investigator', 'plan']);
    expect(w.github.pulls).toHaveLength(1);
  });

  test('an operation waits for its plan, runs and finishes with no pull request', async () => {
    const w = await open();
    let ran = '';
    w.agents.queue('operate', async (agent) => {
      ran = agent.cwd;
      await agent.call('report_outcome', { outcome: 'Ran the cleanup script.' });
    });
    const taskId = await createShapedTask(w, 'Run the cleanup script once', 'operation');
    const plan = await w.untilGate(taskId, 'plan');
    expect(w.agents.of('operate')).toHaveLength(0);
    await w.answer(plan, 'approve');
    await w.untilStage(taskId, 'done');
    await w.until('the worktree to go', () => w.task(taskId).worktreePath === null && !existsSync(ran));
    expect(w.task(taskId)).toMatchObject({
      result: { step: 'operate', body: 'Ran the cleanup script.' },
      pullRequest: null,
    });
    expect(ran).not.toBe(w.repoPath);
    expect(w.github.pulls).toEqual([]);
  });

  test('research runs in the repository itself and finishes with its report', async () => {
    const w = await open();
    const taskId = await createShapedTask(w, 'Compare ways to store the greetings', 'research');
    await w.untilStage(taskId, 'answered');
    expect(w.task(taskId)).toMatchObject({
      result: { step: 'research', body: 'Plain text files are the simplest option.' },
      worktreePath: null,
      pullRequest: null,
    });
    expect(w.agents.sessions.map((session) => [session.role, session.cwd])).toEqual([
      ['researcher', w.state.repos[w.repoId]?.path ?? ''],
    ]);
  });

  test('the planner composes investigate, your OK, then an operation: a bad composition comes back to it, and your OK starts the plan', async () => {
    const w = await open();
    classifyAs(w, {
      branch: 'ops/clear-stuck-exports',
      shape: 'change',
      shape_why: 'It asks for something to be done.',
      priority: 'normal',
      priority_why: 'Nothing waits on it.',
      waits_on: [],
      waits_on_why: 'No open task touches the exports.',
    });
    const refusals: string[] = [];
    w.agents.queue('plan', async (agent) => {
      await agent
        .call('reshape_task', {
          steps: ['investigate', 'plan', 'operate'],
          reason: 'Find it, then clear it.',
        })
        .catch((error: Error) => refusals.push(error.message));
      await agent.call('reshape_task', {
        steps: ['investigate', 'your_ok', 'plan', 'operate'],
        reason: 'Find what is stuck, then clear it.',
      });
    });
    const taskId = await w.createTask('The nightly exports are stuck. Clear them.');
    const ok = await w.untilGate(taskId, 'proposal');
    expect(refusals).toEqual([
      "An investigation turns into a change or an operation only with the human's OK: put `your_ok` between `investigate` and `plan`.",
    ]);
    expect(ok).toMatchObject({
      title: 'Run an operation from this diagnosis?',
      body: 'Find what is stuck, then clear it.\n\nPlan the operation. You approve the plan before anything runs.',
    });
    expect(w.task(taskId)).toMatchObject({
      pipeline: ['investigate', 'your_ok', 'plan', 'operate'],
      result: { step: 'investigate', body: 'The greeting files were never written.' },
    });
    await w.answer(ok, 'approve');
    await w.answer(await w.untilGate(taskId, 'plan'), 'approve');
    await w.untilStage(taskId, 'done');
    expect(w.task(taskId)).toMatchObject({
      result: { step: 'operate', body: 'Ran the cleanup script.' },
      proposal: { status: 'accepted' },
      pullRequest: null,
    });
    expect(w.agents.sessions.map((session) => session.key)).toEqual([
      'plan',
      'investigator',
      'plan',
      'operate',
    ]);
    expect(w.github.pulls).toEqual([]);
  });
});
