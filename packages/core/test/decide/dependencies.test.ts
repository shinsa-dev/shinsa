import { describe, expect, test } from 'bun:test';
import {
  listActiveRuns,
  listDependents,
  listOpenGates,
  listWaitsOn,
  parseBriefing,
  resolveLiveness,
  resolveQueue,
} from '../../src/index.ts';
import {
  createHarness,
  createTask,
  pullRequest,
  reachReviewGate,
  readyWorktree,
  shipAndMerge,
} from '../harness.ts';

describe('dependencies', () => {
  test('a task with no dependency starts at once, however many decisions are waiting', () => {
    const harness = createHarness();
    for (const intent of ['One', 'Two', 'Three', 'Four']) {
      const taskId = createTask(harness, { intent });
      harness.send({
        type: 'agent.ask',
        runId: harness.activeRun(taskId).id,
        gateId: `q-${intent}`,
        question: 'Which?',
        context: null,
      });
    }
    expect(listOpenGates(harness.state)).toHaveLength(4);
    const low = createTask(harness, { intent: 'Tidy the logs', priority: 'low' });
    expect(harness.task(low).stage).toBe('planning');
    expect(harness.activeRun(low).status).toBe('running');
  });

  test('a dependent waits without a worktree or an agent until its parent merges', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Run the chat on MCP v2' });
    const child = createTask(harness, { intent: 'Embed the chat', blockedBy: [parent] });
    expect(harness.task(child).stage).toBe('queued');
    expect(harness.task(child).stageReason).toBe('waiting for “Run the chat on MCP v2” to finish');
    expect(harness.effectsOf('worktree.create').map((effect) => effect.taskId)).not.toContain(child);
    expect(listActiveRuns(harness.state, child)).toHaveLength(0);
    expect(resolveLiveness(harness.state, harness.task(child))).toBe('system');
    expect(resolveQueue(harness.state, 0).waiting.map((task) => task.id)).toEqual([child]);

    shipAndMerge(harness, parent);
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.lastEffect('worktree.create').taskId).toBe(child);
    readyWorktree(harness, child);
    expect(harness.task(child).stage).toBe('planning');
    expect(harness.activeRun(child).prompt).toContain('which has merged');
  });

  test('a chain starts one link at a time', () => {
    const harness = createHarness();
    const mcp = createTask(harness, { intent: 'MCP v2' });
    const chat = createTask(harness, { intent: 'Embedded chat', blockedBy: [mcp] });
    const paywalls = createTask(harness, { intent: 'Paywall editing in the chat', blockedBy: [chat] });
    expect(harness.task(chat).stage).toBe('queued');
    expect(harness.task(paywalls).stage).toBe('queued');

    shipAndMerge(harness, mcp);
    readyWorktree(harness, chat);
    expect(harness.task(chat).stage).toBe('planning');
    expect(harness.task(paywalls).stage).toBe('queued');

    shipAndMerge(harness, chat);
    readyWorktree(harness, paywalls);
    expect(harness.task(paywalls).stage).toBe('planning');
  });

  test('marking the parent done releases its dependents too', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    const child = createTask(harness, { intent: 'Child', blockedBy: [parent] });
    harness.send({ type: 'task.complete', taskId: parent });
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.lastEffect('worktree.create').taskId).toBe(child);
  });

  test('triage can name the task this one waits on, but your choice wins', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    const other = createTask(harness, { intent: 'Other' });
    const inferred = createTask(harness, { intent: 'Inferred', dependsOn: parent });
    expect(harness.task(inferred).blockedBy).toEqual([parent]);
    expect(harness.task(inferred).activity.at(-2)).toMatchObject({
      actor: 'shinsa',
      text: 'Waits on “Parent”',
    });
    const chosen = createTask(harness, { intent: 'Chosen', blockedBy: [other], dependsOn: parent });
    expect(harness.task(chosen).blockedBy).toEqual([other]);
    const both = createTask(harness, { intent: 'Both', dependsOn: [parent, other, parent] });
    expect(harness.task(both).blockedBy).toEqual([parent, other]);
  });

  test('a task can wait on several tasks, and starts only when all of them finish', () => {
    const harness = createHarness();
    const api = createTask(harness, { intent: 'Ship the API' });
    const design = createTask(harness, { intent: 'Ship the design' });
    const screen = createTask(harness, { intent: 'Build the screen', blockedBy: [api, design] });
    expect(harness.task(screen).stageReason).toBe('waiting for “Ship the API”, “Ship the design” to finish');
    expect(listWaitsOn(harness.state, harness.task(screen)).map((task) => task.id)).toEqual([api, design]);

    shipAndMerge(harness, api);
    expect(harness.task(screen).stage).toBe('queued');
    expect(harness.task(screen).stageReason).toBe('waiting for “Ship the design” to finish');
    expect(listWaitsOn(harness.state, harness.task(screen)).map((task) => task.id)).toEqual([design]);

    harness.send({ type: 'task.complete', taskId: design });
    expect(harness.task(screen).stage).toBe('triage');
    readyWorktree(harness, screen);
    expect(harness.activeRun(screen).prompt).toContain(
      'This task builds on "Ship the API" and "Ship the design", which are all finished.'
    );
  });

  test('several tasks can wait on the same parent, and all start when it merges', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'MCP v2' });
    const chat = createTask(harness, { intent: 'Embedded chat', blockedBy: [parent] });
    const cli = createTask(harness, { intent: 'CLI client', blockedBy: [parent] });
    expect(listDependents(harness.state, parent).map((task) => task.id)).toEqual([chat, cli]);
    reachReviewGate(harness, parent);
    expect(resolveQueue(harness.state, 0).ready[0]?.unblocks).toBe(2);

    harness.send({
      type: 'gate.answer',
      gateId: harness.openGate(parent).id,
      decision: 'approve',
      response: null,
    });
    harness.send({
      type: 'pull_request.record',
      taskId: parent,
      pullRequest: pullRequest({ state: 'merged' }),
    });
    expect(harness.task(chat).stage).toBe('triage');
    expect(harness.task(cli).stage).toBe('triage');
    expect(harness.effectsOf('worktree.create').map((effect) => effect.taskId)).toEqual(
      expect.arrayContaining([chat, cli])
    );
  });

  test('a diamond starts the join only after both branches merge', () => {
    const harness = createHarness();
    const a = createTask(harness, { intent: 'A' });
    const b = createTask(harness, { intent: 'B', blockedBy: [a] });
    const c = createTask(harness, { intent: 'C', blockedBy: [a] });
    const d = createTask(harness, { intent: 'D', blockedBy: [b, c] });
    expect(() => harness.send({ type: 'task.block', taskId: a, blockedBy: [d] })).toThrow(
      '“D” already waits on this task.'
    );

    shipAndMerge(harness, a);
    readyWorktree(harness, b);
    readyWorktree(harness, c);
    expect(harness.task(b).stage).toBe('planning');
    expect(harness.task(c).stage).toBe('planning');
    expect(harness.task(d).stage).toBe('queued');

    shipAndMerge(harness, b);
    expect(harness.task(d).stage).toBe('queued');
    expect(harness.task(d).stageReason).toBe('waiting for “C” to finish');

    shipAndMerge(harness, c);
    expect(harness.task(d).stage).toBe('triage');
  });

  test('cancelling one of several parents pauses the dependent, and Retry keeps waiting on the rest', () => {
    const harness = createHarness();
    const b = createTask(harness, { intent: 'B' });
    const c = createTask(harness, { intent: 'C' });
    const d = createTask(harness, { intent: 'D', blockedBy: [b, c] });
    harness.send({ type: 'task.cancel', taskId: b });
    const gate = harness.openGate(d);
    expect(gate.title).toBe('“B” was cancelled');
    expect(gate.body).toContain('Retry to keep waiting on “C” only');

    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    expect(harness.task(d).blockedBy).toEqual([c]);
    expect(harness.task(d).stage).toBe('queued');
    expect(listOpenGates(harness.state, d)).toHaveLength(0);

    shipAndMerge(harness, c);
    expect(harness.task(d).stage).toBe('triage');
  });

  test('waiting on several can be added to and removed from one at a time', () => {
    const harness = createHarness();
    const a = createTask(harness, { intent: 'A' });
    const b = createTask(harness, { intent: 'B' });
    const c = createTask(harness, { intent: 'C' });
    const child = createTask(harness, { intent: 'Child', blockedBy: [a] });
    harness.send({ type: 'task.block', taskId: child, blockedBy: [a, b] });
    expect(harness.task(child).blockedBy).toEqual([a, b]);

    harness.send({ type: 'task.cancel', taskId: a });
    expect(harness.openGate(child).purpose).toBe('failure');
    harness.send({ type: 'task.block', taskId: child, blockedBy: [a, b, c] });
    expect(harness.task(child).blockedBy).toEqual([a, b, c]);
    harness.send({ type: 'task.block', taskId: child, blockedBy: [b, c] });
    expect(harness.task(child).blockedBy).toEqual([b, c]);
    expect(listOpenGates(harness.state, child)).toHaveLength(0);
    expect(harness.task(child).stage).toBe('queued');

    shipAndMerge(harness, b);
    harness.send({ type: 'task.block', taskId: child, blockedBy: [b] });
    expect(harness.task(child).blockedBy).toEqual([b]);
    expect(harness.task(child).stage).toBe('triage');
  });

  test('waiting can be added, changed and dropped later', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    const child = createTask(harness, { intent: 'Child' });
    const planner = harness.activeRun(child);
    harness.send({ type: 'task.block', taskId: child, blockedBy: [parent] });
    expect(harness.task(child).stage).toBe('queued');
    expect(harness.state.runs[planner.id]?.outcome).toBe('cancelled');

    harness.send({ type: 'task.block', taskId: child, blockedBy: [] });
    expect(harness.task(child).stage).toBe('triage');
    readyWorktree(harness, child);
    expect(harness.task(child).stage).toBe('planning');
  });

  test('a dependency that would loop, or was cancelled, is refused', () => {
    const harness = createHarness();
    const a = createTask(harness, { intent: 'A' });
    const b = createTask(harness, { intent: 'B', blockedBy: [a] });
    expect(() => harness.send({ type: 'task.block', taskId: a, blockedBy: [b] })).toThrow(
      '“B” already waits on this task.'
    );
    const gone = createTask(harness, { intent: 'Gone' });
    harness.send({ type: 'task.cancel', taskId: gone });
    expect(() => createTask(harness, { intent: 'C', blockedBy: [gone] })).toThrow('“Gone” was cancelled');
  });

  test('cancelling a parent pauses its waiting dependents with a clear note', () => {
    const harness = createHarness();
    const parent = createTask(harness, { intent: 'Parent' });
    const child = createTask(harness, { intent: 'Child', blockedBy: [parent] });
    const grandchild = createTask(harness, { intent: 'Grandchild', blockedBy: [child] });
    harness.send({ type: 'task.cancel', taskId: parent });
    const gate = harness.openGate(child);
    expect(gate.purpose).toBe('failure');
    expect(gate.title).toBe('“Parent” was cancelled');
    expect(harness.task(child).stage).toBe('queued');
    expect(listOpenGates(harness.state, grandchild)).toHaveLength(0);

    harness.send({ type: 'gate.answer', gateId: gate.id, decision: 'approve', response: null });
    expect(harness.task(child).blockedBy).toEqual([]);
    expect(harness.task(child).stage).toBe('triage');
    expect(harness.task(grandchild).stage).toBe('queued');
  });

  test('low priority decisions sit below the rest and never lead the guide', () => {
    const harness = createHarness();
    const low = createTask(harness, { intent: 'Low', priority: 'low' });
    reachReviewGate(harness, low);
    const normal = createTask(harness, { intent: 'Normal' });
    reachReviewGate(harness, normal);
    const queue = resolveQueue(harness.state, 0);
    expect(queue.ready.map((entry) => entry.task.id)).toEqual([normal, low]);
    expect(parseBriefing({ now: { task: low, why: 'It is ready.' } }, queue, 0)).toBeNull();
    const briefing = parseBriefing(
      { now: { task: normal, why: 'It is ready.' }, next: [{ task: low, why: 'It is ready too.' }] },
      queue,
      0
    );
    expect(briefing?.now?.taskId).toBe(normal);
  });
});
