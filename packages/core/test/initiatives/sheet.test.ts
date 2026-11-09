import { describe, expect, test } from 'bun:test';
import {
  listInitiatives,
  resolveInitiativeSheet,
  type Round,
  type ShinsaState,
  type Task,
} from '../../src/index.ts';
import {
  approve,
  completePhase,
  createHarness,
  createTask,
  type Harness,
  proposePlan,
  shipAndMerge,
} from '../harness.ts';

function createInitiativeHarness() {
  const harness = createHarness();
  harness.send({
    type: 'initiative.write',
    initiativeId: null,
    name: 'Chat split',
    phases: [
      { id: null, name: 'Dock' },
      { id: null, name: 'Studio' },
    ],
  });
  const initiative = listInitiatives(harness.state)[0];
  if (!initiative) throw new Error('no initiative');
  const [dock, studio] = initiative.phases.map((phase) => phase.id);
  return { harness, id: initiative.id, dock: dock ?? '', studio: studio ?? '' };
}

function member(harness: Harness, id: string, phaseId: string | null, request: string, extra = {}) {
  const taskId = createTask(harness, { request, ...extra });
  harness.send({ type: 'task.join_initiative', taskId, initiativeId: id, phaseId });
  return taskId;
}

function withTask(state: ShinsaState, taskId: string, patch: Partial<Task>): ShinsaState {
  const task = state.tasks[taskId];
  if (!task) throw new Error(`no task ${taskId}`);
  return { ...state, tasks: { ...state.tasks, [taskId]: { ...task, ...patch } } };
}

describe('resolveInitiativeSheet', () => {
  test('sorts members into needs you, now, next by phase, shipped and dropped', () => {
    const { harness, id, dock, studio } = createInitiativeHarness();
    const gated = member(harness, id, dock, 'Plan the dock', { planFirst: true });
    proposePlan(harness, gated);
    const working = member(harness, id, dock, 'Build the dock');
    const shipped = member(harness, id, dock, 'Ship the ask box');
    shipAndMerge(harness, shipped);
    const waiting = member(harness, id, studio, 'Port the studio', { waitsOn: [working] });
    const loose = member(harness, id, null, 'Tidy the docs', { waitsOn: [working] });
    const dropped = member(harness, id, studio, 'Port the old studio');
    harness.send({ type: 'task.cancel', taskId: dropped });
    const duplicate = member(harness, id, null, 'Ship the ask box again');
    harness.send({ type: 'task.mark_duplicate', taskId: duplicate, duplicateOf: shipped });
    createTask(harness, { request: 'Not a member' });

    const sheet = resolveInitiativeSheet(harness.state, id, harness.now);
    expect(sheet?.initiative.name).toBe('Chat split');
    expect(sheet?.needsYou.map((entry) => entry.task.id)).toEqual([gated]);
    expect(sheet?.now.map((task) => task.id)).toEqual([working]);
    expect(
      sheet?.next.map((group) => [group.phase?.name ?? null, group.tasks.map((entry) => entry.task.id)])
    ).toEqual([
      ['Studio', [waiting]],
      [null, [loose]],
    ]);
    expect(sheet?.next[0]?.tasks[0]?.waitsOn.map((task) => task.id)).toEqual([working]);
    expect(sheet?.shipped.map((task) => task.id)).toEqual([shipped]);
    expect(sheet?.dropped.map((entry) => [entry.task.id, entry.reason])).toEqual([
      [duplicate, 'Duplicate of “Ship the ask box”'],
      [dropped, 'Cancelled by you'],
    ]);
    expect(
      sheet?.progress.map((entry) => [entry.phase?.name ?? null, entry.total, entry.shipped, entry.dropped])
    ).toEqual([
      ['Dock', 3, 1, 0],
      ['Studio', 2, 0, 1],
      [null, 2, 0, 1],
    ]);
  });

  test('lists approved plans, earlier rounds and judgement calls as decisions, newest first', () => {
    const { harness, id, dock } = createInitiativeHarness();
    const taskId = member(harness, id, dock, 'Build the dock', { planFirst: true });
    proposePlan(harness, taskId);
    approve(harness, taskId);
    const runId = harness.activeRun(taskId).id;
    harness.send({
      type: 'agent.complete_phase',
      runId,
      summary: 'Did the phase.',
      spots: [{ file: 'src/a.ts', start: 1, end: 3, attention: 'critical', why: 'The change.' }],
      judgementCalls: [
        {
          title: 'Keep the counter',
          call: 'Kept the generation counter.',
          reason: 'Both docks use it.',
          file: null,
          line: null,
        },
      ],
      reply: null,
    });
    completePhase(harness, taskId);
    const round = {
      title: 'First round',
      outcome: { goal: 'Restart the dock.' },
      endedAt: 5,
      queuedAt: 1,
    } as Round;
    const unplanned = { title: 'Second round', outcome: null, endedAt: null, queuedAt: 6 } as Round;
    const state = withTask(harness.state, taskId, { rounds: [round, unplanned] });
    const decisions = resolveInitiativeSheet(state, id, harness.now)?.decisions ?? [];
    expect(decisions.map((decision) => [decision.kind, decision.text])).toEqual([
      ['call', 'Kept the generation counter.'],
      ['plan', harness.task(taskId).plan?.document?.goal ?? ''],
      ['plan', 'Restart the dock.'],
    ]);
  });

  test('keeps a member whose phase was removed under no phase, and is null for an unknown initiative', () => {
    const { harness, id } = createInitiativeHarness();
    const taskId = member(harness, id, null, 'Tidy the docs');
    const state = withTask(harness.state, taskId, { initiativePhaseId: 'gone' });
    const sheet = resolveInitiativeSheet(state, id, harness.now);
    expect(sheet?.progress.map((entry) => [entry.phase?.name ?? null, entry.total])).toEqual([
      ['Dock', 0],
      ['Studio', 0],
      [null, 1],
    ]);
    expect(resolveInitiativeSheet(harness.state, 'nope', harness.now)).toBeNull();
  });

  test('an empty initiative shows its phases with nothing in them', () => {
    const { harness, id } = createInitiativeHarness();
    const sheet = resolveInitiativeSheet(harness.state, id, harness.now);
    expect(sheet?.progress.map((entry) => [entry.phase?.name, entry.total])).toEqual([
      ['Dock', 0],
      ['Studio', 0],
    ]);
    expect(sheet?.next).toEqual([]);
  });
});
