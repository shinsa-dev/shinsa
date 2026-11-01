import { describe, expect, test } from 'bun:test';
import {
  applyStatePatch,
  applyTaskDetail,
  decide,
  isSummarizedTask,
  listSummarizedTasks,
  resolveStatePatch,
  resolveStats,
  resolveTaskCost,
  resolveTaskDetail,
  resolveViewPatch,
  type ShinsaCommand,
  type ShinsaState,
  type StatePatch,
  selectLeadGate,
  serializeState,
  serializeViewState,
  summarizeRun,
  summarizeTask,
  type WireState,
} from '../../src/index.ts';
import { createHarness, createTask, registerRepo, shipAndMerge } from '../harness.ts';

type Harness = ReturnType<typeof createHarness>;

function plain<T>(value: T) {
  return JSON.parse(JSON.stringify(value)) as T;
}

function attachEvidence(harness: Harness, taskId: string, title: string) {
  harness.send({
    type: 'agent.attach_evidence',
    runId: harness.activeRun(taskId).id,
    kind: 'note',
    title,
    uri: `${title} in detail.`,
  });
}

function seed() {
  const harness = createHarness();
  const repoId = registerRepo(harness);
  const merged = createTask(harness, { repoId, request: 'Ship the scroll fix' });
  attachEvidence(harness, merged, 'Scroll note');
  shipAndMerge(harness, merged);
  const cancelled = createTask(harness, { repoId, request: 'Drop the old tabs' });
  harness.send({ type: 'task.cancel', taskId: cancelled });
  const open = createTask(harness, { repoId, request: 'Keep the open one' });
  attachEvidence(harness, open, 'Open note');
  return { harness, merged, cancelled, open };
}

function decideNext(state: ShinsaState, command: ShinsaCommand, now: number) {
  let counter = 0;
  return decide(state, command, { now, newId: () => `view-${now}-${++counter}` });
}

describe('the view state a socket gets on connect', () => {
  test('summarizes settled tasks and leaves out their history', () => {
    const { harness, merged, cancelled, open } = seed();
    const summarized = listSummarizedTasks(harness.state);
    expect([...summarized].sort()).toEqual([merged, cancelled].sort());
    const view = serializeViewState(harness.state, summarized);
    const task = view.tasks[merged];
    expect(task?.summarized).toBe(true);
    expect(task?.plan).toBeNull();
    expect(task?.report).toBeNull();
    expect(task?.phaseReports).toEqual([]);
    expect(task?.activity.length).toBeLessThanOrEqual(2);
    expect(task?.activity.at(-1)).toBe(harness.task(merged).activity.at(-1));
    expect(task?.pullRequest).toBe(harness.task(merged).pullRequest);
    expect(view.tasks[open]).toBe(harness.task(open));
    expect(Object.values(view.evidence).map((evidence) => evidence.taskId)).toEqual([open]);
    expect(Object.values(view.gates).every((gate) => gate.taskId === open || gate.status === 'open')).toBe(
      true
    );
    const runs = Object.values(view.runs).filter((run) => run.taskId === merged);
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((run) => run.summary === null && (run.attempts?.length ?? 0) <= 1)).toBe(true);
    expect(runs.every((run) => run.attempts?.every((attempt) => attempt.handoff === null) ?? true)).toBe(
      true
    );
    expect(JSON.stringify(view).length).toBeLessThan(JSON.stringify(serializeState(harness.state)).length);
  });

  test('is the wire state itself when nothing is summarized', () => {
    const { harness } = seed();
    expect(serializeViewState(harness.state, new Set())).toEqual(serializeState(harness.state));
  });

  test('reuses one summary per task and run object', () => {
    const { harness, merged } = seed();
    const task = harness.task(merged);
    expect(summarizeTask(task)).toBe(summarizeTask(task));
    expect(isSummarizedTask(summarizeTask(task))).toBe(true);
    expect(isSummarizedTask(task)).toBe(false);
    const run = serializeState(harness.state).runs[Object.keys(harness.state.runs)[0] ?? ''];
    if (!run) throw new Error('no run');
    expect(summarizeRun(run)).toBe(summarizeRun(run));
  });

  test('keeps the last attempt of a run without its hand-off', () => {
    const { harness } = seed();
    const run = serializeState(harness.state).runs[Object.keys(harness.state.runs)[0] ?? ''];
    if (!run) throw new Error('no run');
    const attempt = {
      attemptId: 'a',
      provider: 'claude',
      model: null,
      resumed: false,
      handoff: null,
      startedAt: 1,
    };
    const handoff = { tokens: 10, text: 'Earlier turns.' } as unknown as NonNullable<typeof attempt.handoff>;
    const last = { ...attempt, attemptId: 'b', handoff, cwd: '/wt' };
    expect(summarizeRun({ ...run, attempts: [attempt, last] }).attempts).toEqual([
      { ...attempt, attemptId: 'b' },
    ]);
  });

  test('keeps what Stats, cost and the queue read', () => {
    const { harness, merged, cancelled, open } = seed();
    const view = serializeViewState(harness.state, listSummarizedTasks(harness.state));
    const window = { days: ['day'], dayOf: () => 'day' };
    expect(resolveStats(view, window)).toEqual(resolveStats(harness.state, window));
    for (const id of [merged, cancelled, open]) {
      const task = harness.task(id);
      expect(resolveTaskCost(view, task).total).toEqual(resolveTaskCost(harness.state, task).total);
      expect(selectLeadGate(view, task)).toEqual(selectLeadGate(harness.state, task));
    }
  });
});

describe('view patches', () => {
  test('rebuild the same view a fresh connect would send, through a reopen', () => {
    const { harness, merged, cancelled, open } = seed();
    let state = harness.state;
    let summarized: ReadonlySet<string> = listSummarizedTasks(state);
    let client = plain(serializeViewState(state, summarized));
    const commands: ShinsaCommand[] = [
      { type: 'task.prioritize', taskId: open, priority: 'urgent' },
      { type: 'task.prioritize', taskId: cancelled, priority: 'low' },
      { type: 'task.message', taskId: merged, text: 'Also fix the header scroll.', kind: 'new_round' },
      { type: 'task.prioritize', taskId: merged, priority: 'high' },
      { type: 'task.cancel', taskId: open },
    ];
    for (const [index, command] of commands.entries()) {
      const decision = decideNext(state, command, harness.now + index + 1);
      const shared = resolveStatePatch(state, decision.state, decision.changes);
      const view = resolveViewPatch(shared, state, decision.state, summarized);
      const next = applyStatePatch(client, plain(view.patch));
      expect(next).toEqual(plain(serializeViewState(decision.state, view.summarized)));
      client = next ?? client;
      summarized = view.summarized;
      state = decision.state;
    }
    expect(state.tasks[merged]?.stage).not.toBe('merged');
    expect(summarized.has(merged)).toBe(false);
    expect(summarized.has(cancelled)).toBe(true);
    expect(summarized.has(open)).toBe(false);
    expect(client.tasks[merged]?.summarized).toBeUndefined();
    expect(Object.values(client.evidence).some((evidence) => evidence.taskId === merged)).toBe(true);
  });

  test('pass a patch through untouched when it names no summarized task', () => {
    const { harness, open } = seed();
    const summarized = listSummarizedTasks(harness.state);
    const decision = decideNext(
      harness.state,
      { type: 'task.prioritize', taskId: open, priority: 'low' },
      harness.now + 1
    );
    const shared = resolveStatePatch(harness.state, decision.state, decision.changes);
    const view = resolveViewPatch(shared, harness.state, decision.state, summarized);
    expect(view.patch).toBe(shared);
    expect(view.summarized).toBe(summarized);
  });

  test('drop a change that leaves a summary as it was', () => {
    const { harness, merged } = seed();
    const summarized = listSummarizedTasks(harness.state);
    const task = harness.task(merged);
    const next = {
      ...harness.state,
      seq: harness.state.seq + 1,
      tasks: { ...harness.state.tasks, [merged]: { ...task, report: null } },
    };
    const shared = resolveStatePatch(harness.state, next, { tasks: [merged] });
    const view = resolveViewPatch(shared, harness.state, next, summarized);
    expect(view.patch.records).toEqual({});
  });

  test('remove a summarized task that is gone, with its entries', () => {
    const { harness, cancelled } = seed();
    const state = harness.state;
    const summarized = listSummarizedTasks(state);
    const runs = Object.keys(state.runs).filter((id) => state.runs[id]?.taskId === cancelled);
    const { [cancelled]: _gone, ...tasks } = state.tasks;
    const next: ShinsaState = {
      ...state,
      seq: state.seq + 1,
      tasks,
      runs: Object.fromEntries(Object.entries(state.runs).filter(([id]) => !runs.includes(id))),
    };
    const shared = resolveStatePatch(state, next, { tasks: [cancelled], runs });
    const view = resolveViewPatch(shared, state, next, summarized);
    const client = applyStatePatch(plain(serializeViewState(state, summarized)), plain(view.patch));
    expect(client).toEqual(plain(serializeViewState(next, view.summarized)));
    expect(view.summarized.has(cancelled)).toBe(false);
  });
});

describe('task detail', () => {
  test('turns a summary back into the full task with its gates, runs and evidence', () => {
    const { harness, merged } = seed();
    const summarized = listSummarizedTasks(harness.state);
    const view = plain(serializeViewState(harness.state, summarized));
    const detail = plain(resolveTaskDetail(harness.state, merged));
    const rest = new Set([...summarized].filter((id) => id !== merged));
    expect(applyTaskDetail(view, detail)).toEqual(plain(serializeViewState(harness.state, rest)));
    expect(detail.task).toEqual(plain(harness.task(merged)));
    expect(Object.keys(detail.evidence)).toHaveLength(1);
  });

  test('is refused when it is not of the state the page holds', () => {
    const { harness, merged } = seed();
    const view: WireState = serializeViewState(harness.state, listSummarizedTasks(harness.state));
    const detail = { ...resolveTaskDetail(harness.state, merged), seq: harness.state.seq + 1 };
    expect(applyTaskDetail(view, detail)).toBeNull();
  });

  test('removes a task the engine no longer has', () => {
    const { harness, merged } = seed();
    const view = serializeViewState(harness.state, listSummarizedTasks(harness.state));
    const detail = resolveTaskDetail(harness.state, 'missing');
    expect(detail.task).toBeNull();
    const next = applyTaskDetail(
      { ...view, tasks: { ...view.tasks, missing: summarizeTask(harness.task(merged)) } },
      detail
    );
    expect(next?.tasks.missing).toBeUndefined();
  });

  test('keeps a patch for that task whole once the page holds it', () => {
    const { harness, merged } = seed();
    const summarized = listSummarizedTasks(harness.state);
    const kept = new Set([...summarized].filter((id) => id !== merged));
    const decision = decideNext(
      harness.state,
      { type: 'task.prioritize', taskId: merged, priority: 'low' },
      harness.now + 1
    );
    const shared: StatePatch = resolveStatePatch(harness.state, decision.state, decision.changes);
    expect(resolveViewPatch(shared, harness.state, decision.state, kept).patch).toBe(shared);
  });
});
