import { describe, expect, test } from 'bun:test';
import {
  listTeamEscalations,
  NO_TEAM_FEED,
  resolveTeamEscalationTag,
  type Task,
  type TeamFeedTask,
} from '../../src/index.ts';
import { createHarness, createTask, type Harness } from '../harness.ts';

function entry(task: Task, instanceId = 'kai'): TeamFeedTask {
  return {
    task,
    gates: [],
    project: null,
    repo: null,
    owner: 'kai',
    machine: 'Kai’s MacBook',
    teamId: 'core',
    instanceId,
  };
}

const HANDOFF = {
  waitedMinutes: 60,
  ownerActiveAt: null,
  foundBy: null,
  ratings: null,
  mergesAt: null,
  blockedBy: null,
};

function escalated(
  harness: Harness,
  at: number,
  reason = 'Urgent, and the merge waited 60 minutes for you.'
) {
  const taskId = createTask(harness);
  return { ...harness.task(taskId), escalation: { at, reason, handoff: HANDOFF } };
}

describe('listTeamEscalations', () => {
  test('lists a teammate’s open escalated tasks, oldest escalation first', () => {
    const harness = createHarness();
    const late = escalated(harness, 2_000);
    const early = escalated(harness, 1_000);
    const calm = harness.task(createTask(harness));
    const feed = { machines: [], tasks: [entry(late), entry(calm), entry(early)] };
    expect(listTeamEscalations(feed).map((item) => item.entry.task.id)).toEqual([early.id, late.id]);
    expect(listTeamEscalations(feed)[0]?.escalation).toEqual(early.escalation);
    expect(listTeamEscalations(NO_TEAM_FEED)).toEqual([]);
  });

  test('leaves out a finished task, a task this machine holds and a repeat from another team', () => {
    const harness = createHarness();
    const open = escalated(harness, 1_000);
    const held = escalated(harness, 1_000);
    const finished = { ...escalated(harness, 1_000), stage: 'cancelled' as const };
    const feed = {
      machines: [],
      tasks: [entry(open), { ...entry(open), teamId: 'other' }, entry(held), entry(finished)],
    };
    expect(listTeamEscalations(feed, new Set([held.id])).map((item) => item.entry.task.id)).toEqual([
      open.id,
    ]);
  });

  test('tags each escalation by machine, task and time, so a new escalation notifies again', () => {
    const harness = createHarness();
    const task = escalated(harness, 1_000);
    const [first] = listTeamEscalations({ machines: [], tasks: [entry(task)] });
    const [again] = listTeamEscalations({
      machines: [],
      tasks: [entry({ ...task, escalation: { at: 5_000, reason: 'Again.', handoff: HANDOFF } })],
    });
    const [elsewhere] = listTeamEscalations({ machines: [], tasks: [entry(task, 'mona')] });
    expect(first && resolveTeamEscalationTag(first)).toBe(`escalation:kai ${task.id}:1000`);
    expect(again && resolveTeamEscalationTag(again)).toBe(`escalation:kai ${task.id}:5000`);
    expect(elsewhere && resolveTeamEscalationTag(elsewhere)).toBe(`escalation:mona ${task.id}:1000`);
  });
});
