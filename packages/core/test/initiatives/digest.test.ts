import { describe, expect, test } from 'bun:test';
import {
  describeInitiativeDigest,
  describeMilestones,
  listInitiatives,
  resolveInitiativeSheet,
} from '../../src/index.ts';
import {
  createHarness,
  createInitiative,
  createTask,
  type Harness,
  proposePlan,
  shipAndMerge,
} from '../harness.ts';

function withInitiative() {
  const harness = createHarness();
  createInitiative(harness, { phases: ['Studio'] });
  const initiative = listInitiatives(harness.state)[0];
  if (!initiative) throw new Error('no initiative');
  return { harness, id: initiative.id, studio: initiative.phases[0]?.id ?? '' };
}

function member(harness: Harness, id: string, phaseId: string | null, request: string, extra = {}) {
  const taskId = createTask(harness, { request, ...extra });
  harness.send({ type: 'task.join_initiative', taskId, initiativeId: id, phaseId });
  return taskId;
}

function digestOf(harness: Harness, id: string) {
  const sheet = resolveInitiativeSheet(harness.state, id, harness.now);
  if (!sheet) throw new Error('no sheet');
  return describeInitiativeDigest(sheet);
}

describe('describeInitiativeDigest', () => {
  test('lists each section with its members, waits and reasons', () => {
    const { harness, id, studio } = withInitiative();
    const gated = member(harness, id, null, 'Plan the dock', { planFirst: true });
    proposePlan(harness, gated);
    const working = member(harness, id, null, 'Build the dock');
    member(harness, id, studio, 'Port the studio', { waitsOn: [working] });
    member(harness, id, null, 'Tidy the docs', { waitsOn: [working] });
    const shipped = member(harness, id, null, 'Ship the ask box');
    shipAndMerge(harness, shipped);
    const dropped = member(harness, id, null, 'Port the old studio');
    harness.send({ type: 'task.cancel', taskId: dropped });
    const digest = digestOf(harness, id);
    expect(digest).toContain('Needs the human:');
    expect(digest).toContain(`(shinsa://task/${gated}): Plan to approve`);
    expect(digest).toContain('Working now:');
    expect(digest).toContain('Next, phase Studio:');
    expect(digest).toContain('Next, no phase:');
    expect(digest).toMatch(/waiting on another task, waits on [A-Z]+-\d+/);
    expect(digest).toContain(`Shipped:\n- `);
    expect(digest).toContain(`(shinsa://task/${dropped}): Cancelled`);
  });

  test('says when the initiative has no tasks', () => {
    const { harness, id } = withInitiative();
    expect(digestOf(harness, id)).toBe('The initiative has no tasks yet.');
  });
});

describe('describeMilestones', () => {
  test('names each task, or a task that is gone', () => {
    const { harness, id } = withInitiative();
    const taskId = member(harness, id, null, 'Build the dock');
    const text = describeMilestones(harness.state, [
      { taskId, kind: 'merged', text: 'pull request merged', at: 1 },
      { taskId: 'gone', kind: 'cancelled', text: '', at: 2 },
    ]);
    expect(text).toContain(`(shinsa://task/${taskId}) merged: pull request merged`);
    expect(text).toContain('- A task was cancelled');
  });
});
