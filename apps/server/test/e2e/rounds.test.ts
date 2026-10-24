import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { type MessageKind, resolveCurrentRound, resolveTaskRounds, type TaskShape } from '@shinsa/core';
import type { JsonSchema } from '../../src/agents/providers/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { MessageInbox } from '../../src/triage/inbox.ts';
import { type Classifier, createClassifier, routeUserCommand } from '../../src/triage/message.ts';
import { type AgentScript, World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

afterEach(async () => {
  await world?.dispose();
  world = null;
});

const ROUND = /This is round (\d+) of the task/;

function readRound(prompt: string) {
  return Number(ROUND.exec(prompt)?.[1] ?? 1);
}

const BUILD: AgentScript = async (agent) => {
  const phase = Number(/builder for phase (\d+)/.exec(agent.prompt)?.[1] ?? 1);
  const round = readRound(agent.prompt);
  agent.write(`round-${round}-phase-${phase}.txt`, `round ${round}, phase ${phase}\n`);
  await agent.call('complete_phase', {
    summary: `Wrote round ${round}, phase ${phase}.`,
    spots: [
      { file: `round-${round}-phase-${phase}.txt`, start: 1, end: 1, attention: 'normal', why: 'New.' },
    ],
    judgement_calls: [],
  });
};

async function open() {
  world = await World.create({ checks: ['true'] });
  world.agents.queue('builder', ...Array.from({ length: 40 }, () => BUILD));
  return world;
}

function answerAs(kind: MessageKind, title: string, shape: TaskShape = 'change'): QuickJson {
  return <T>() => Promise.resolve({ kind, shape, title, why: `The message reads as ${kind}.` } as T);
}

async function send(w: World, taskId: string, text: string, classify: Classifier | null) {
  const inbox = classify ? new MessageInbox(w.engine, classify.message) : null;
  inbox?.start();
  await routeUserCommand(w.engine, { type: 'task.message', taskId, text }, null, classify);
  await inbox?.settle();
  inbox?.stop();
}

async function shipRound(w: World, taskId: string) {
  const round = resolveCurrentRound(w.task(taskId)).number;
  const review = await w.untilGate(taskId, 'review');
  await w.answer(review, 'approve');
  await w.until(
    'the push to land',
    () => w.task(taskId).pushPending !== true && w.task(taskId).pullRequest !== null
  );
  const number = w.task(taskId).pullRequest?.number ?? 0;
  w.github.update(number, { checks: 'passing' });
  await w.sync(taskId);
  await w.until(
    'the merge gate or the next round',
    () =>
      resolveCurrentRound(w.task(taskId)).number > round ||
      w.gates(taskId).some((gate) => gate.type === 'merge')
  );
}

async function toMergeGate(w: World, taskId: string) {
  await shipRound(w, taskId);
  return w.untilGate(taskId, 'merge');
}

function statuses(w: World, taskId: string) {
  return resolveTaskRounds(w.task(taskId)).map((round) => [round.number, round.status]);
}

async function git(cwd: string, ...args: string[]) {
  return runCommandOrThrow(['git', ...args], cwd);
}

describe('a task that runs in rounds', () => {
  test('a mono-chat with three rounds ships them all onto one pull request', async () => {
    const w = await open();
    const taskId = await w.createTask('Add MCP v2');
    await w.until('the planner', () => w.agents.of('planner').length === 1);
    await send(
      w,
      taskId,
      'Also stream the tool results',
      createClassifier(answerAs('new_round', 'Stream the tool results'))
    );
    expect(statuses(w, taskId)).toEqual([
      [1, 'active'],
      [2, 'waiting'],
    ]);
    await shipRound(w, taskId);
    await w.until('round 2 to start', () => resolveCurrentRound(w.task(taskId)).number === 2);
    await send(
      w,
      taskId,
      'And cache the server list',
      createClassifier(answerAs('new_round', 'Cache the server list'))
    );
    await shipRound(w, taskId);
    await w.until('round 3 to start', () => resolveCurrentRound(w.task(taskId)).number === 3);
    const merge = await toMergeGate(w, taskId);
    expect(w.github.pulls).toHaveLength(1);
    expect(statuses(w, taskId)).toEqual([
      [1, 'shipped'],
      [2, 'shipped'],
      [3, 'active'],
    ]);
    const branch = w.task(taskId).branch ?? '';
    expect(await w.branchLog(branch)).toHaveLength(6);
    for (const round of [1, 2, 3]) {
      expect(await git(w.origin, 'show', `${branch}:round-${round}-phase-1.txt`)).toBe(
        `round ${round}, phase 1`
      );
    }
    await w.answer(merge, 'approve');
    await w.untilStage(taskId, 'merged');
    expect(statuses(w, taskId)).toEqual([
      [1, 'merged'],
      [2, 'merged'],
      [3, 'merged'],
    ]);
    expect(resolveTaskRounds(w.task(taskId)).map((round) => round.pullRequest?.number)).toEqual([1, 1, 1]);
    const planners = w.agents.of('planner');
    expect(planners).toHaveLength(3);
    const first = planners[0]?.sessionId ?? null;
    expect(planners.slice(1).map((session) => session.resume)).toEqual([first, first]);
    expect(planners[2]?.prompt).toContain('This is round 3 of the task.');
    expect(planners[2]?.prompt).toContain('Its commits go onto pull request #1');
  });

  test('a round shipped as a stacked pull request opens its own pull request on top of the open one', async () => {
    const w = await open();
    const taskId = await w.createTask('Add MCP v2');
    await w.until('the planner', () => w.agents.of('planner').length === 1);
    await send(
      w,
      taskId,
      'Then add the settings screen',
      createClassifier(answerAs('new_round', 'Add the settings screen'))
    );
    await w.engine.dispatch({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    await shipRound(w, taskId);
    const first = w.github.pulls[0];
    await w.until('round 2 to start', () => resolveCurrentRound(w.task(taskId)).number === 2);
    const merge = await toMergeGate(w, taskId);
    const [bottom, top] = w.github.pulls;
    expect(bottom).toMatchObject({ number: 1, head: first?.head, base: 'main', state: 'OPEN' });
    expect(top).toMatchObject({
      number: 2,
      head: `${first?.head}-round-2`,
      base: first?.head,
      state: 'OPEN',
    });
    expect(await git(w.origin, 'log', '--format=%s', top?.head ?? '', `^${bottom?.head ?? ''}`)).toBe(
      ['fix: write the second file', 'fix: write the first file'].join('\n')
    );
    await w.answer(merge, 'approve');
    await w.untilStage(taskId, 'merged');
    expect(w.github.pulls.map((pull) => pull.state)).toEqual(['MERGED', 'MERGED']);
    const merges = w.github.calls
      .filter((call) => call[0] === 'pr' && call[1] === 'merge')
      .map((call) => call[2]);
    expect(merges).toEqual(['2', '1']);
    expect(statuses(w, taskId)).toEqual([
      [1, 'merged'],
      [2, 'merged'],
    ]);
  });

  test('after a merge the task stays open, and a new round starts from fresh main on a new branch', async () => {
    const w = await open();
    const taskId = await w.createTask('Add MCP v2');
    const merge = await toMergeGate(w, taskId);
    await w.answer(merge, 'approve');
    await w.untilStage(taskId, 'merged');
    const first = w.task(taskId).branch ?? '';
    await git(w.repoPath, 'push', '-q', 'origin', `${first}:refs/heads/main`);
    await w.until('the old worktree to go', () => w.task(taskId).worktreePath === null);
    await send(
      w,
      taskId,
      'Now add the settings screen',
      createClassifier(answerAs('new_round', 'Add the settings screen'))
    );
    expect(statuses(w, taskId)).toEqual([
      [1, 'merged'],
      [2, 'active'],
    ]);
    await w.untilStage(taskId, 'awaiting_review');
    const task = w.task(taskId);
    expect(task.branch).toBe(`${first}-round-2`);
    expect(existsSync(join(task.worktreePath ?? '', 'round-1-phase-1.txt'))).toBe(true);
    expect(await git(w.repoPath, 'log', '--format=%s', `origin/main..${task.branch ?? ''}`)).toBe(
      ['fix: write the second file', 'fix: write the first file'].join('\n')
    );
    await toMergeGate(w, taskId);
    expect(w.github.pulls.map((pull) => [pull.number, pull.head, pull.base])).toEqual([
      [1, first, 'main'],
      [2, `${first}-round-2`, 'main'],
    ]);
  });

  test('the classifier tells feedback from a new idea with a typed decision', async () => {
    const w = await open();
    const asked: { prompt: string; schema: JsonSchema | undefined }[] = [];
    const ask: QuickJson = <T>(_system: string, prompt: string, schema?: JsonSchema) => {
      asked.push({ prompt, schema });
      const idea = prompt.includes('dark mode');
      return Promise.resolve({
        kind: idea ? 'new_round' : 'feedback',
        shape: 'change',
        title: idea ? 'Add a dark mode toggle' : 'Use tabs',
        why: idea ? 'It is new work for the same goal.' : 'It corrects the work in progress.',
      } as T);
    };
    const classify = createClassifier(ask);
    let release: (() => void) | null = null;
    w.agents.queue('planner', async (agent) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      expect(agent.steers.some((text) => text.includes('Use tabs instead of spaces'))).toBe(true);
      await agent.call('propose_plan', {
        goal: 'Add MCP v2.',
        phases: [{ title: 'Build it', detail: 'All of it.' }],
        behaviour: [],
        approach: 'Directly.',
        files: [],
        out_of_scope: [],
        verification: ['The checks pass.'],
        questions: [],
      });
    });
    const taskId = await w.createTask('Add MCP v2');
    await w.until('the planner', () => release !== null);
    await send(w, taskId, 'Use tabs instead of spaces', classify);
    await w.until('the steer', () => (w.agents.of('planner')[0]?.steers.length ?? 0) > 0);
    await send(w, taskId, 'Also add a dark mode toggle', classify);
    expect(asked[0]?.schema?.properties).toMatchObject({
      kind: { type: 'string', enum: ['acknowledge', 'feedback', 'new_round', 'separate_task'] },
    });
    expect(asked[0]?.prompt).toContain('Message:\nUse tabs instead of spaces');
    expect(asked[0]?.prompt).toContain(
      '- kind (choice): A round of this task is in progress. What is this message?'
    );
    expect(statuses(w, taskId)).toEqual([
      [1, 'active'],
      [2, 'waiting'],
    ]);
    expect(resolveTaskRounds(w.task(taskId))[1]).toMatchObject({
      title: 'Add a dark mode toggle',
      why: 'It is new work for the same goal.',
      request: 'Also add a dark mode toggle',
    });
    const events = w.task(taskId).activity.map((entry) => entry.text);
    expect(events).toContain('Sent instructions');
    expect(events).toContain('Queued round 2: Add a dark mode toggle');
    (release as unknown as () => void)();
    await w.untilStage(taskId, 'awaiting_review');
  });

  test('a split-off the classifier suggests can be declined and kept in the chat as the next round', async () => {
    const w = await open();
    const taskId = await w.createTask('Add MCP v2');
    await w.until('the planner', () => w.agents.of('planner').length === 1);
    await send(
      w,
      taskId,
      'Can you also redo the billing page?',
      createClassifier(answerAs('separate_task', 'Redo the billing page'))
    );
    const suggestion = w.task(taskId).suggestions?.[0];
    expect(suggestion).toMatchObject({ splitOff: true, title: 'Redo the billing page', status: 'open' });
    expect(statuses(w, taskId)).toEqual([[1, 'active']]);
    await w.engine.dispatch({ type: 'suggestion.keep', taskId, suggestionId: suggestion?.id ?? '' });
    expect(w.task(taskId).suggestions?.[0]).toMatchObject({ status: 'dismissed', keptRound: 2 });
    expect(statuses(w, taskId)).toEqual([
      [1, 'active'],
      [2, 'waiting'],
    ]);
    await shipRound(w, taskId);
    await w.until('round 2 to start', () => resolveCurrentRound(w.task(taskId)).number === 2);
    await w.until('the round 2 planner', () => w.agents.of('planner').length === 2);
    expect(w.agents.of('planner')[1]?.prompt).toContain('Can you also redo the billing page?');
  });

  test('a restart mid-round resumes the round where it was, with its rounds intact', async () => {
    const w = await open();
    let hold: Promise<void> | null = null;
    const taskId = await w.createTask('Add MCP v2');
    await w.until('the planner', () => w.agents.of('planner').length === 1);
    await send(w, taskId, 'Then add search', createClassifier(answerAs('new_round', 'Add search')));
    w.agents.queue('planner', async (agent) => {
      hold = agent.hang();
      await hold;
    });
    await shipRound(w, taskId);
    await w.until('round 2 to start', () => resolveCurrentRound(w.task(taskId)).number === 2);
    await w.until('the round 2 planner', () => w.agents.of('planner').length === 2);
    const before = w.task(taskId).rounds;
    await w.restartGracefully();
    await w.untilStage(taskId, 'awaiting_review');
    expect(w.task(taskId).rounds?.map((round) => [round.number, round.status])).toEqual(
      before?.map((round) => [round.number, round.status])
    );
    const planners = w.agents.of('planner');
    expect(planners.at(-1)?.resume).toBe(planners[1]?.sessionId);
    expect(planners.at(-1)?.prompt).toContain('Shinsa restarted');
    expect(resolveCurrentRound(w.task(taskId))).toMatchObject({ number: 2, status: 'active' });
  });
});
