import { describe, expect, test } from 'bun:test';
import {
  createState,
  isTaskClosed,
  isTaskResting,
  listOpenGates,
  listQueuedRounds,
  listStackedPullRequests,
  needsMessageKind,
  replayEventLog,
  resolveCurrentRound,
  resolveMessageEffect,
  resolveRoundBase,
  resolveRoundProgress,
  resolveTaskRounds,
  SHAPE_PIPELINES,
  type Task,
} from '../../src/index.ts';
import {
  approve,
  buildAll,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  linkSession,
  PASSING,
  PLAN,
  proposePlan,
  pullRequest,
  pushed,
  reachReviewGate,
  reachShipping,
  registerRepo,
  shipAndMerge,
} from '../harness.ts';

function readyRound(harness: Harness, taskId: string) {
  harness.send({ type: 'config.record', taskId, problems: [] });
  const task = harness.task(taskId);
  if (task.stage !== 'triage' || !task.branch) return;
  harness.send({ type: 'worktree.ready', taskId, path: `/wt/${taskId}`, branch: task.branch });
}

function reachMergeGate(harness: Harness, taskId: string, number = 42) {
  if (harness.task(taskId).pullRequest) {
    reachReviewGate(harness, taskId);
    approve(harness, taskId);
    pushed(harness, taskId);
  } else {
    reachShipping(harness, taskId);
  }
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ number, url: `https://github.com/o/r/pull/${number}` }),
  });
}

function newIdea(harness: Harness, taskId: string, text: string) {
  return harness.send({ type: 'task.message', taskId, text, kind: 'new_round', title: text.slice(0, 20) });
}

function listStatuses(task: Task) {
  return resolveTaskRounds(task).map((round) => [round.number, round.status]);
}

function merge(harness: Harness, taskId: string, number = 42) {
  approve(harness, taskId);
  harness.send({
    type: 'pull_request.record',
    taskId,
    pullRequest: pullRequest({ number, url: `https://github.com/o/r/pull/${number}`, state: 'merged' }),
  });
}

describe('a task is a conversation of rounds', () => {
  test('every task starts with one active round named after its request', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'MCP v2' });
    const [round] = resolveTaskRounds(harness.task(taskId));
    expect(round).toMatchObject({
      number: 1,
      title: 'MCP v2',
      request: 'MCP v2',
      status: 'active',
      shipping: 'onto_pull_request',
      branch: `fix/${taskId}`,
    });
  });

  test('a task stored without rounds reads as one round in the state it is in', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    const { rounds: _rounds, ...older } = harness.task(taskId);
    expect(resolveTaskRounds(older)).toEqual([
      expect.objectContaining({ number: 1, status: 'merged', pullRequest: expect.anything() }),
    ]);
    expect(resolveCurrentRound(older).number).toBe(1);
    const fresh = { ...older, stage: 'building' as const, pullRequest: null };
    expect(resolveTaskRounds(fresh)[0]).toMatchObject({ status: 'active', pullRequest: null });
  });

  test('a new idea while the round works waits, then starts at the merge gate onto the open pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'MCP v2' });
    linkSession(harness, taskId, 'planner-session');
    newIdea(harness, taskId, 'Also stream the tool results');
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'active'],
      [2, 'waiting'],
    ]);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    reachMergeGate(harness, taskId);
    const task = harness.task(taskId);
    expect(listStatuses(task)).toEqual([
      [1, 'shipped'],
      [2, 'active'],
    ]);
    expect(task.stage).toBe('triage');
    expect(task.pullRequest?.number).toBe(42);
    expect(task.branch).toBe(`fix/${taskId}`);
    expect(task.plan).toBeNull();
    expect(task.phaseReports).toEqual([]);
    expect(
      Object.values(harness.state.gates).some((gate) => gate.type === 'merge' && gate.status === 'open')
    ).toBe(false);
    readyRound(harness, taskId);
    const planner = harness.activeRun(taskId);
    expect(planner).toMatchObject({
      role: 'agent',
      purpose: 'plan',
      round: 2,
      resume: true,
      sessionId: 'planner-session',
    });
    expect(planner.prompt).toContain('This is round 2 of the task.');
    expect(planner.prompt).toContain('Also stream the tool results');
    expect(planner.prompt).toContain('pull request #42');
    expect(resolveCurrentRound(task).outcome).toBeNull();
    expect(resolveTaskRounds(task)[0]?.outcome).toMatchObject({
      goal: 'Ship it.',
      phases: ['Find the overflow', 'Fix and verify'],
    });
  });

  test('three rounds go onto one pull request, and its merge merges every round', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'MCP v2' });
    newIdea(harness, taskId, 'Round two');
    reachMergeGate(harness, taskId);
    readyRound(harness, taskId);
    newIdea(harness, taskId, 'Round three');
    reachMergeGate(harness, taskId);
    expect(harness.effectsOf('pull_request.push').length).toBeGreaterThan(0);
    readyRound(harness, taskId);
    const builder = () => harness.activeRun(taskId);
    proposePlan(harness, taskId);
    expect(builder()).toMatchObject({ role: 'agent', purpose: 'build', round: 3 });
    harness.send({
      type: 'agent.complete_phase',
      runId: builder().id,
      summary: 'One.',
      spots: [],
      judgementCalls: [],
    });
    harness.send({
      type: 'agent.complete_phase',
      runId: builder().id,
      summary: 'Two.',
      spots: [],
      judgementCalls: [],
    });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({ type: 'agent.report_review', runId: builder().id, summary: null, findings: [] });
    approve(harness, taskId);
    expect(harness.task(taskId).stageReason).toBe('pushing the changes');
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    merge(harness, taskId);
    const task = harness.task(taskId);
    expect(task.stage).toBe('merged');
    expect(listStatuses(task)).toEqual([
      [1, 'merged'],
      [2, 'merged'],
      [3, 'merged'],
    ]);
    expect(resolveTaskRounds(task).map((round) => round.pullRequest?.number)).toEqual([42, 42, 42]);
    expect(isTaskResting(task)).toBe(true);
    expect(replayEventLog(harness.events).state).toEqual(harness.state);
  });

  test('a round shipped as a stacked pull request gets its own branch on top of the open one', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'MCP v2' });
    newIdea(harness, taskId, 'Stack this');
    harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    reachMergeGate(harness, taskId);
    let task = harness.task(taskId);
    expect(task.pullRequest).toBeNull();
    expect(task.branch).toBe(`fix/${taskId}-round-2`);
    expect(resolveCurrentRound(task)).toMatchObject({
      number: 2,
      base: `fix/${taskId}`,
      shipping: 'stacked',
    });
    expect(resolveRoundBase(task)).toBe(`fix/${taskId}`);
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain(`stacked on branch fix/${taskId}`);
    reachMergeGate(harness, taskId, 43);
    task = harness.task(taskId);
    expect(task.pullRequest?.number).toBe(43);
    expect(listStackedPullRequests(task).map((entry) => entry.number)).toEqual([42]);
    merge(harness, taskId, 43);
    task = harness.task(taskId);
    expect(listStatuses(task)).toEqual([
      [1, 'merged'],
      [2, 'merged'],
    ]);
    expect(resolveTaskRounds(task).map((round) => round.pullRequest?.state)).toEqual(['merged', 'merged']);
    expect(listStackedPullRequests(task)).toEqual([]);
  });

  test('a new round after the merge starts from the default branch on a new branch', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'MCP v2' });
    shipAndMerge(harness, taskId);
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('follow_up');
    harness.send({ type: 'task.message', taskId, text: 'Now add the settings page', kind: 'new_round' });
    const task = harness.task(taskId);
    expect(task.stage).toBe('triage');
    expect(task.pullRequest).toBeNull();
    expect(task.branch).toBe(`fix/${taskId}-round-2`);
    expect(resolveCurrentRound(task)).toMatchObject({ number: 2, base: null, status: 'active' });
    expect(resolveRoundBase(task)).toBeNull();
    readyRound(harness, taskId);
    expect(harness.activeRun(taskId).prompt).toContain(
      "It starts from the default branch, which holds the earlier rounds' merged work."
    );
    expect(harness.lastEffect('worktree.remove')).toEqual({ kind: 'worktree.remove', taskId });
  });

  test('a late read of an earlier round’s pull request changes nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Another round', kind: 'new_round' });
    const before = harness.events.length;
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    expect(harness.events).toHaveLength(before);
    expect(harness.task(taskId).stage).toBe('triage');
  });
});

describe('feedback, new work and work that belongs elsewhere', () => {
  test('feedback keeps today’s behaviour: it steers the agent, and at the review gate it goes to the agent', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.message', taskId, text: 'Use the cache.', kind: 'feedback' });
    expect(harness.lastEffect('run.steer')).toMatchObject({ text: 'Use the cache.' });
    reachReviewGate(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Smaller.', kind: 'feedback' });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(resolveTaskRounds(harness.task(taskId))).toHaveLength(1);
  });

  function splitOff(harness: Harness, taskId: string, text: string) {
    harness.send({ type: 'task.message', taskId, text, kind: 'separate_task', why: 'It is its own goal.' });
    return harness.task(taskId).suggestions?.find((suggestion) => suggestion.request === text)?.id ?? '';
  }

  test('work that belongs elsewhere becomes a separate-task suggestion, and keeping it steers the agent now', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'task.message',
      taskId,
      text: 'Also redesign the billing page',
      kind: 'separate_task',
      why: 'Billing is its own project.',
    });
    const [suggestion] = harness.task(taskId).suggestions ?? [];
    expect(suggestion).toMatchObject({
      title: 'Also redesign the billing page',
      why: 'Billing is its own project.',
      splitOff: true,
      runId: null,
    });
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Suggested a separate task: Also redesign the billing page'
    );
    harness.send({ type: 'suggestion.keep', taskId, suggestionId: suggestion?.id ?? '' });
    const task = harness.task(taskId);
    expect(task.suggestions?.[0]).toMatchObject({ status: 'dismissed', keptRound: 1 });
    expect(listStatuses(task)).toEqual([[1, 'active']]);
    expect(harness.lastEffect('run.steer')).toMatchObject({ text: 'Also redesign the billing page' });
    expect(task.activity.map((entry) => entry.text)).toContain(
      'Kept “Also redesign the billing page” in this task and sent it to the agent'
    );
    expect(task.activity.at(-1)).toMatchObject({ kind: 'message', detail: 'Also redesign the billing page' });
    expect(() =>
      harness.send({ type: 'suggestion.keep', taskId, suggestionId: suggestion?.id ?? '' })
    ).toThrow('already been added or dismissed');
  });

  test('keeping a split-off at the review gate asks for the change before the merge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const suggestionId = splitOff(harness, taskId, 'Commit the docs edits too.');
    reachReviewGate(harness, taskId);
    harness.send({ type: 'suggestion.keep', taskId, suggestionId });
    const task = harness.task(taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(listQueuedRounds(task)).toEqual([]);
    expect(task.suggestions?.[0]).toMatchObject({ status: 'dismissed', keptRound: 1 });
  });

  test('keeping a split-off at the merge gate sends the work back instead of waiting for the merge', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachMergeGate(harness, taskId);
    const suggestionId = splitOff(harness, taskId, 'Also file the docs part.');
    harness.send({ type: 'suggestion.keep', taskId, suggestionId });
    const task = harness.task(taskId);
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'fix' });
    expect(listQueuedRounds(task)).toEqual([]);
    expect(listOpenGates(harness.state, taskId)).toEqual([]);
  });

  test('keeping a split-off on a resting task starts the next round at once, of the kind you chose', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    const suggestionId = splitOff(harness, taskId, 'Why is the import slow?');
    harness.send({ type: 'suggestion.keep', taskId, suggestionId, shape: 'investigate' });
    const task = harness.task(taskId);
    expect(task.suggestions?.[0]).toMatchObject({ status: 'dismissed', keptRound: 2 });
    expect(listStatuses(task)).toEqual([
      [1, 'merged'],
      [2, 'active'],
    ]);
    expect(resolveTaskRounds(task)[1]?.pipeline).toEqual([...SHAPE_PIPELINES.investigate]);
    expect(task.activity.map((entry) => entry.text)).toContain(
      'Kept “Why is the import slow?” in this task as round 2'
    );
  });

  test('keeping a split-off on a finished task is refused', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    const suggestionId = splitOff(harness, taskId, 'Rename the page.');
    harness.send({ type: 'task.complete', taskId });
    expect(() => harness.send({ type: 'suggestion.keep', taskId, suggestionId })).toThrow(
      'This task is finished'
    );
  });

  test('a split-off with no room for another suggestion starts a round instead', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.suggest_tasks',
      runId: harness.activeRun(taskId).id,
      suggestions: Array.from({ length: 10 }, (_, index) => ({
        title: `Idea ${index}`,
        request: 'Later.',
        why: 'It came up.',
        waitsOnThis: false,
        splitOff: index === 0,
      })),
    });
    expect(harness.task(taskId).suggestions?.[0]?.splitOff).toBe(true);
    harness.send({ type: 'task.message', taskId, text: 'One more thing', kind: 'separate_task' });
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'active'],
      [2, 'waiting'],
    ]);
  });

  test('a follow-up on a finished answer stays a follow-up unless it asks for new work', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      shape: 'answer',
      reason: 'A question.',
    });
    readyRound(harness, taskId);
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: 'It uses Redis.',
    });
    expect(resolveMessageEffect(harness.state, harness.task(taskId))).toBe('follow_up');
    harness.send({ type: 'task.message', taskId, text: 'Which version?' });
    expect(harness.activeRun(taskId).role).toBe('answerer');
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: 'Seven.',
    });
    harness.send({ type: 'task.message', taskId, text: 'Move it to Valkey', kind: 'new_round' });
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'finished'],
      [2, 'active'],
    ]);
    expect(resolveTaskRounds(harness.task(taskId))[0]?.outcome?.result).toBe('Seven.');
    expect(harness.task(taskId).result).toBeNull();
  });

  test('a question task that never had a branch builds its first change round on the branch triage proposed', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'How does the cache work?', repoId, mode: 'ask' });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'How the cache works',
      repoId,
      size: 'small',
      branch: 'docs/cache',
      waitsOn: [],
    });
    harness.send({ type: 'config.record', taskId, problems: [] });
    harness.send({
      type: 'agent.deliver',
      runId: harness.activeRun(taskId).id,
      step: 'answer',
      body: 'With Redis.',
    });
    harness.send({ type: 'task.message', taskId, text: 'Write that down in the docs', kind: 'new_round' });
    expect(harness.task(taskId)).toMatchObject({ branch: 'docs/cache', stage: 'triage' });
  });

  test('at most five rounds wait at once', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    for (let index = 0; index < 5; index += 1) newIdea(harness, taskId, `Idea ${index}`);
    expect(() => newIdea(harness, taskId, 'One too many')).toThrow('already has 5 rounds waiting');
  });
});

describe('changing the queue of rounds', () => {
  test('a waiting round takes a new request and a title from its first line, and the same request changes nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Add dark mode');
    harness.send({
      type: 'round.update',
      taskId,
      number: 2,
      request: '  Add a light theme\nAnd a toggle.  ',
    });
    const task = harness.task(taskId);
    expect(resolveTaskRounds(task)[1]).toMatchObject({
      status: 'waiting',
      request: 'Add a light theme\nAnd a toggle.',
      title: 'Add a light theme',
    });
    expect(task.activity.at(-1)).toMatchObject({
      actor: 'you',
      kind: 'round',
      text: 'Changed queued round 2: Add a light theme',
    });
    expect(
      harness.send({ type: 'round.update', taskId, number: 2, request: 'Add a light theme\nAnd a toggle.' })
        .events
    ).toEqual([]);
    expect(() => harness.send({ type: 'round.update', taskId, number: 2, request: '   ' })).toThrow(
      'Write a message first.'
    );
  });

  test('removing a waiting round moves the rounds after it up, and the next one still starts at rest', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'First idea');
    newIdea(harness, taskId, 'Second idea');
    newIdea(harness, taskId, 'Third idea');
    harness.send({ type: 'round.remove', taskId, number: 3 });
    const task = harness.task(taskId);
    expect(resolveTaskRounds(task).map((round) => [round.number, round.request])).toEqual([
      [1, task.request],
      [2, 'First idea'],
      [3, 'Third idea'],
    ]);
    expect(task.activity.at(-1)).toMatchObject({
      text: 'Removed queued round 3: Second idea',
      detail: 'Second idea',
    });
    harness.send({ type: 'round.remove', taskId, number: 2 });
    shipAndMerge(harness, taskId);
    expect(resolveCurrentRound(harness.task(taskId))).toMatchObject({ number: 2, request: 'Third idea' });
  });

  test('a round that started, one that does not exist and a finished task refuse the change', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(() => harness.send({ type: 'round.remove', taskId, number: 1 })).toThrow(
      'Round 1 has already started, so it can no longer be changed or removed.'
    );
    expect(() => harness.send({ type: 'round.update', taskId, number: 4, request: 'x' })).toThrow(
      'This task has no round 4.'
    );
    newIdea(harness, taskId, 'Later');
    harness.send({ type: 'task.cancel', taskId });
    expect(() => harness.send({ type: 'round.remove', taskId, number: 2 })).toThrow('This task is finished.');
  });
});

describe('how a round ships', () => {
  test('a waiting round switches between onto the pull request and stacked, and repeats change nothing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    expect(resolveTaskRounds(harness.task(taskId))[1]?.shipping).toBe('stacked');
    expect(harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' }).events).toEqual([]);
    expect(() => harness.send({ type: 'round.ship', taskId, number: 9, shipping: 'stacked' })).toThrow(
      'This task has no round 9.'
    );
  });

  test('a round that started but has not gone to its pull request can still switch, and then cannot', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    reachMergeGate(harness, taskId);
    readyRound(harness, taskId);
    harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    let task = harness.task(taskId);
    expect(task.pullRequest).toBeNull();
    expect(task.branch).toBe(`fix/${taskId}-round-2`);
    expect(task.activity.at(-1)?.text).toBe('Round 2 ships as its own stacked pull request');
    harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'onto_pull_request' });
    task = harness.task(taskId);
    expect(task.pullRequest).toMatchObject({ number: 42, state: 'open', checks: 'pending' });
    expect(task.branch).toBe(`fix/${taskId}`);
    expect(task.activity.at(-1)?.text).toBe('Round 2 ships onto the open pull request');
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    approve(harness, taskId);
    expect(() => harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' })).toThrow(
      'Round 2 has already gone to its pull request'
    );
    expect(() => harness.send({ type: 'round.ship', taskId, number: 1, shipping: 'stacked' })).toThrow(
      'Round 1 has already gone to its pull request'
    );
  });

  test('a fresh round with nothing open only records how it ships', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Next', kind: 'new_round' });
    const branch = harness.task(taskId).branch;
    harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    expect(harness.task(taskId).branch).toBe(branch);
    expect(resolveCurrentRound(harness.task(taskId)).shipping).toBe('stacked');
  });

  test('a round with no pull request waits for the open one to merge, and a later round keeps its pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'task.message',
      taskId,
      text: 'Explain the cache',
      kind: 'new_round',
      shape: 'answer',
    });
    reachMergeGate(harness, taskId);
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'active'],
      [2, 'waiting'],
    ]);
    merge(harness, taskId);
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'merged'],
      [2, 'active'],
    ]);
    expect(harness.task(taskId)).toMatchObject({ branch: null, proposedBranch: `fix/${taskId}-round-2` });
  });

  test('the agent of a later round keeps a pull request step while one is open', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    reachMergeGate(harness, taskId);
    readyRound(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({ type: 'agent.reshape', runId, shape: 'answer', reason: 'Only a question.' })
    ).toThrow('keep `build`, `pull_request` and `merge`');
    harness.send({
      type: 'agent.reshape',
      runId,
      steps: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge', 'operate'],
      reason: 'Backfill after the merge.',
    });
    expect(harness.task(taskId).pipeline).toContain('operate');
  });

  test('a later round with an operation after the merge merges the earlier round on its pull request when it waits for your OK', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Then backfill');
    reachMergeGate(harness, taskId);
    readyRound(harness, taskId);
    harness.send({
      type: 'agent.reshape',
      runId: harness.activeRun(taskId).id,
      steps: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge', 'operate'],
      reason: 'Backfill after the merge.',
    });
    proposePlan(harness, taskId, { ...PLAN, operation: ['Run the backfill and check the count is 0.'] });
    approve(harness, taskId);
    completePhase(harness, taskId);
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ state: 'merged' }) });
    const task = harness.task(taskId);
    expect(task.stage).toBe('awaiting_operation');
    expect(listStatuses(task)).toEqual([
      [1, 'merged'],
      [2, 'active'],
    ]);
    expect(resolveTaskRounds(task).map((round) => round.pullRequest?.state)).toEqual(['merged', 'merged']);
    expect(replayEventLog(harness.events).state).toEqual(harness.state);
  });

  test('an earlier round’s pull request merged on GitHub ends that round, and the round in flight goes on to its own pull request', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachMergeGate(harness, taskId);
    newIdea(harness, taskId, 'Also the flicker');
    readyRound(harness, taskId);
    const planner = harness.activeRun(taskId);
    const root = harness.task(taskId).branch;
    const merged = pullRequest({ state: 'merged' });
    harness.send({ type: 'pull_request.record', taskId, pullRequest: merged });
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'merged'],
      [2, 'active'],
    ]);
    expect(resolveTaskRounds(harness.task(taskId))[0]?.pullRequest?.state).toBe('merged');
    expect(harness.task(taskId)).toMatchObject({
      stage: 'planning',
      pullRequest: null,
      branch: `${root}-round-2`,
    });
    expect(resolveCurrentRound(harness.task(taskId))).toMatchObject({ base: null, pullRequest: null });
    expect(harness.activeRun(taskId).id).toBe(planner.id);
    expect(harness.task(taskId).activity.at(-1)?.text).toBe(
      'Pull request #42 merged, so round 2 opens its own pull request'
    );
    expect(harness.send({ type: 'pull_request.record', taskId, pullRequest: merged }).events).toEqual([]);
  });

  test('the agent of a later round cannot wait for your OK while a pull request is open, so a veto never strands it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachMergeGate(harness, taskId);
    newIdea(harness, taskId, 'Also look into the flicker');
    readyRound(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({
        type: 'agent.reshape',
        runId,
        steps: [
          'investigate',
          'your_ok',
          'plan',
          'build',
          'checks',
          'agent_review',
          'your_review',
          'pull_request',
          'merge',
        ],
        reason: 'Find the flicker first.',
      })
    ).toThrow("cannot wait for the human's OK before it plans");
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'agent', purpose: 'plan' });
    expect(harness.task(taskId).pullRequest?.state).toBe('open');
  });
});

describe('ending a task', () => {
  test('marking a resting task done closes it and cancels the rounds that waited', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    shipAndMerge(harness, taskId);
    expect(isTaskClosed(harness.task(taskId))).toBe(false);
    harness.send({ type: 'task.complete', taskId });
    const task = harness.task(taskId);
    expect(task).toMatchObject({ stage: 'done', stageReason: 'marked done by you' });
    expect(isTaskClosed(task)).toBe(true);
    expect(harness.send({ type: 'task.complete', taskId }).events).toEqual([]);
    expect(() => harness.send({ type: 'round.ship', taskId, number: 1, shipping: 'stacked' })).toThrow(
      'This task is finished.'
    );
  });

  test('cancelling cancels the open round and every waiting one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    expect(needsMessageKind(harness.state, harness.task(taskId))).toBe(true);
    harness.send({ type: 'task.cancel', taskId });
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'cancelled'],
      [2, 'cancelled'],
    ]);
    expect(needsMessageKind(harness.state, harness.task(taskId))).toBe(false);
  });

  test('a task is not marked done while an earlier round’s pull request is open', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    harness.send({ type: 'round.ship', taskId, number: 2, shipping: 'stacked' });
    reachMergeGate(harness, taskId);
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'shipped'],
      [2, 'active'],
    ]);
    expect(() => harness.send({ type: 'task.complete', taskId })).toThrow(
      'Pull request #42 of round 1 is still open. Merge it before the task is marked done, or cancel the task.'
    );
    harness.send({ type: 'task.cancel', taskId });
    expect(listStatuses(harness.task(taskId))).toEqual([
      [1, 'cancelled'],
      [2, 'cancelled'],
    ]);
  });

  test('an agent marks its task done only when nothing is open', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    expect(() => harness.send({ type: 'task.complete', taskId }, { onBehalf: true, byTask: taskId })).toThrow(
      'still has rounds waiting to start'
    );
    const shipped = createTask(harness, { request: 'Shipped' });
    reachMergeGate(harness, shipped);
    const mergeGate = harness.openGate(shipped).id;
    expect(() => harness.send({ type: 'task.complete', taskId: shipped }, { onBehalf: true })).toThrow(
      'Pull request #42 of this task is still open.'
    );
    expect(harness.state.gates[mergeGate]?.status).toBe('open');
    const checking = createTask(harness, { request: 'Checking' });
    reachShipping(harness, checking);
    harness.send({
      type: 'pull_request.record',
      taskId: checking,
      pullRequest: pullRequest({ checks: 'pending' }),
    });
    expect(() => harness.send({ type: 'task.complete', taskId: checking }, { onBehalf: true })).toThrow(
      'Pull request #42 of this task is still open.'
    );
    const resting = createTask(harness, { request: 'Resting' });
    shipAndMerge(harness, resting);
    harness.send({ type: 'task.complete', taskId: resting }, { onBehalf: true, byTask: resting });
    expect(isTaskClosed(harness.task(resting))).toBe(true);
  });
});

describe('what each round keeps', () => {
  test('a new round starts with no review summary or findings', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: 'Read the whole change; one naming nit.',
      findings: [
        { severity: 'optional', file: 'src/a.ts', line: 2, title: 'Vague name', message: 'Rename it.' },
      ],
    });
    expect(harness.task(taskId).reviewSummary).toBe('Read the whole change; one naming nit.');
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    readyRound(harness, taskId);
    expect(resolveCurrentRound(harness.task(taskId)).number).toBe(2);
    expect(harness.task(taskId).reviewSummary).toBeNull();
    expect(harness.task(taskId).findings).toEqual([]);
  });

  test('evidence counts for the round it was attached in', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    proposePlan(harness, taskId, {
      goal: 'Ship it.',
      phases: [{ title: 'Only', detail: 'All of it.' }],
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [{ label: 'Panel tests', command: 'bun test src/panel', phases: [1] }],
      questions: [],
      evidence: ['screenshot'],
    });
    const builder = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.attach_evidence',
      runId: builder,
      kind: 'screenshot',
      title: 'Before',
      uri: 'a.png',
    });
    harness.send({
      type: 'agent.complete_phase',
      runId: builder,
      summary: 'Done.',
      spots: [],
      judgementCalls: [],
    });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    readyRound(harness, taskId);
    proposePlan(harness, taskId, {
      goal: 'Again.',
      phases: [{ title: 'Only', detail: 'All of it.' }],
      behaviour: [],
      approach: '',
      files: [],
      outOfScope: [],
      verification: [{ label: 'Panel tests', command: 'bun test src/panel', phases: [1] }],
      questions: [],
      evidence: ['screenshot'],
    });
    const next = harness.activeRun(taskId).id;
    expect(() =>
      harness.send({
        type: 'agent.complete_phase',
        runId: next,
        summary: 'Done.',
        spots: [],
        judgementCalls: [],
      })
    ).toThrow('screenshot');
    harness.send({
      type: 'agent.attach_evidence',
      runId: next,
      kind: 'screenshot',
      title: 'After',
      uri: 'b.png',
    });
    expect(Object.values(harness.state.evidence).map((item) => item.round)).toEqual([undefined, 2]);
    harness.send({
      type: 'agent.complete_phase',
      runId: next,
      summary: 'Done.',
      spots: [],
      judgementCalls: [],
    });
    expect(harness.task(taskId).stage).toBe('checking');
  });

  test('activity, runs and gates of a later round carry its number; messages of an earlier round stay there', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.message', taskId, text: 'Round one note.' });
    newIdea(harness, taskId, 'Next');
    reachMergeGate(harness, taskId);
    readyRound(harness, taskId);
    harness.send({ type: 'task.message', taskId, text: 'Round two note.' });
    const prompt = harness.activeRun(taskId).prompt ?? '';
    expect(harness.task(taskId).activity.at(-1)).toMatchObject({ round: 2, text: 'Sent instructions' });
    harness.send({ type: 'run.end', runId: harness.activeRun(taskId).id, outcome: 'failed', summary: 'x' });
    harness.send({ type: 'run.end', runId: harness.activeRun(taskId).id, outcome: 'failed', summary: 'x' });
    expect(harness.openGate(taskId)).toMatchObject({ type: 'failure', round: 2 });
    harness.send({ type: 'task.retry', taskId });
    expect(harness.activeRun(taskId).prompt).toContain('The human added since:\n- Round two note.');
    expect(harness.activeRun(taskId).prompt).not.toContain('Round one note.');
    expect(prompt).toContain('This is round 2');
  });

  test('a later round’s agent resumes the session the round agent last used; a reviewer with no session yet starts fresh', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    newIdea(harness, taskId, 'Next');
    proposePlan(harness, taskId);
    linkSession(harness, taskId, 'builder-1');
    completePhase(harness, taskId);
    linkSession(harness, taskId, 'builder-2');
    completePhase(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    harness.send({
      type: 'agent.report_review',
      runId: harness.activeRun(taskId).id,
      summary: null,
      findings: [],
    });
    approve(harness, taskId);
    pushed(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest() });
    readyRound(harness, taskId);
    proposePlan(harness, taskId);
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'build',
      resume: true,
      sessionId: 'builder-2',
    });
    harness.send({
      type: 'agent.complete_phase',
      runId: harness.activeRun(taskId).id,
      summary: 'One.',
      spots: [],
      judgementCalls: [],
    });
    expect(harness.activeRun(taskId)).toMatchObject({
      role: 'agent',
      purpose: 'build',
      resume: true,
      sessionId: 'builder-2',
      phaseIndex: 1,
    });
    harness.send({
      type: 'agent.complete_phase',
      runId: harness.activeRun(taskId).id,
      summary: 'Two.',
      spots: [],
      judgementCalls: [],
    });
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    expect(harness.activeRun(taskId)).toMatchObject({ role: 'reviewer', resume: false });
    expect(harness.activeRun(taskId).prompt).toContain('The earlier rounds were reviewed already.');
  });
});

describe('the progress of a round', () => {
  test('an ended round shows its steps by how it ended', () => {
    const round = {
      number: 2,
      title: 'Next',
      request: 'Next',
      why: null,
      shipping: 'onto_pull_request' as const,
      status: 'shipped' as const,
      pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'] as const,
      branch: 'b',
      base: null,
      pullRequest: null,
      queuedAt: 0,
      startedAt: 0,
      endedAt: 1,
      outcome: { goal: 'G', phases: ['One', 'Two'], headline: null, result: null },
    };
    const shipped = resolveRoundProgress({ ...round, pipeline: [...round.pipeline] });
    expect(shipped.phases.map((phase) => [phase.title, phase.status])).toEqual([
      ['Plan', 'done'],
      ['One', 'done'],
      ['Two', 'done'],
      ['Checks and agent review', 'done'],
      ['Your review', 'done'],
      ['Pull request', 'done'],
      ['Merge', 'waiting'],
    ]);
    expect(shipped.current?.title).toBe('Merge');
    const waiting = resolveRoundProgress({
      ...round,
      pipeline: ['answer'],
      status: 'waiting',
      outcome: null,
    });
    expect(waiting.phases).toEqual([
      { key: 'answer', title: 'Answer', detail: null, status: 'pending', planned: false },
    ]);
    const cancelled = resolveRoundProgress({
      ...round,
      pipeline: ['plan', 'build'],
      status: 'cancelled',
      outcome: null,
    });
    expect(cancelled.phases.map((phase) => phase.status)).toEqual(['skipped', 'skipped']);
    expect(cancelled.done).toBe(2);
    expect(resolveRoundProgress({ ...round, pipeline: ['plan', 'build'], status: 'merged' }).done).toBe(3);
    expect(resolveRoundProgress({ ...round, pipeline: ['answer'], status: 'finished' }).done).toBe(1);
    expect(resolveRoundProgress({ ...round, pipeline: ['answer'], status: 'active' }).done).toBe(0);
  });
});

describe('replaying rounds', () => {
  test('a state without the task a round event names changes nothing', () => {
    const state = createState();
    for (const event of [
      {
        type: 'round.queued' as const,
        taskId: 'gone',
        round: { number: 2, title: 'x', request: 'x', why: null, shipping: 'stacked' as const, pipeline: [] },
      },
      { type: 'round.started' as const, taskId: 'gone', number: 2, branch: null, base: null, onto: null },
      { type: 'round.shipping_changed' as const, taskId: 'gone', number: 2, shipping: 'stacked' as const },
      { type: 'round.updated' as const, taskId: 'gone', number: 2, request: 'x', title: 'x' },
      { type: 'round.removed' as const, taskId: 'gone', number: 2 },
    ]) {
      expect(replayEventLog([{ ...event, seq: 1, at: 1 }]).state.tasks).toEqual(state.tasks);
    }
  });
});
