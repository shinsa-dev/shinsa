import { describe, expect, test } from 'bun:test';
import {
  type Gate,
  HOUR_MS,
  PRESENCE_RETENTION_HOURS,
  replayEventLog,
  resolvePresenceHour,
  resolveTaskTiming,
  type UsageWait,
} from '../../src/index.ts';
import { createHarness, createTask, proposePlan, registerRepo } from '../harness.ts';

function gate(taskId: string, id: string): Gate {
  return {
    id,
    taskId,
    type: 'question',
    status: 'open',
    title: 'Which colour?',
    body: '',
    runId: null,
    openedAt: 0,
    answeredAt: null,
    decision: null,
    response: null,
  };
}

function usageWait(id: string): UsageWait {
  return {
    id,
    runId: 'run-1',
    role: 'agent',
    phaseIndex: null,
    account: null,
    resetAt: 99_999,
    armedAt: 0,
    autoResume: true,
    status: 'armed',
  };
}

function timingOf(harness: ReturnType<typeof createHarness>, taskId: string) {
  return resolveTaskTiming(harness.task(taskId));
}

describe('task timing', () => {
  test('starts empty and stays unwritten while nothing pauses or needs you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(harness.task(taskId).timing).toBeUndefined();
    expect(timingOf(harness, taskId)).toEqual({
      paused: [],
      pausedSince: null,
      needsYou: [],
      needsYouSince: null,
      openGates: [],
      inputs: [],
    });
  });

  test('pauses while snoozed and closes the span once unsnoozed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.snooze', taskId });
    const from = harness.now;
    expect(timingOf(harness, taskId).pausedSince).toBe(from);
    harness.advance(500);
    harness.send({ type: 'task.unsnooze', taskId });
    expect(timingOf(harness, taskId)).toMatchObject({
      paused: [{ from, to: harness.now }],
      pausedSince: null,
    });
  });

  test('keeps one span while several causes overlap', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'task.snooze_changed', taskId, snoozed: true });
    const from = harness.now;
    harness.replay({ type: 'task.backlog_changed', taskId, backlog: true, cause: 'you' });
    harness.replay({ type: 'task.snooze_changed', taskId, snoozed: false });
    expect(timingOf(harness, taskId)).toMatchObject({ paused: [], pausedSince: from });
    harness.replay({ type: 'task.backlog_changed', taskId, backlog: false, cause: 'started' });
    expect(timingOf(harness, taskId).paused).toEqual([{ from, to: harness.now }]);
  });

  test('pauses while waiting on other tasks', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'task.staged', taskId, stage: 'waiting_on_tasks', reason: 'Waits on LOC-1' });
    const from = harness.now;
    harness.replay({ type: 'task.staged', taskId, stage: 'planning', reason: 'Planning' });
    expect(timingOf(harness, taskId).paused).toEqual([{ from, to: harness.now }]);
  });

  test('pauses while a usage wait is armed, not once it resumed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'usage_wait.armed', taskId, wait: usageWait('wait-1') });
    const from = harness.now;
    harness.replay({ type: 'usage_wait.ended', taskId, waitId: 'wait-1', status: 'resumed' });
    expect(timingOf(harness, taskId)).toMatchObject({
      paused: [{ from, to: harness.now }],
      pausedSince: null,
    });
  });

  test('a plan gate you approve is one answered wait', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { planFirst: true });
    proposePlan(harness, taskId);
    const plan = harness.openGate(taskId);
    const from = timingOf(harness, taskId).needsYouSince;
    expect(from).not.toBeNull();
    expect(timingOf(harness, taskId).openGates).toEqual([plan.id]);
    harness.advance(1_000);
    harness.send({ type: 'gate.answer', gateId: plan.id, decision: 'approve', response: null });
    const timing = timingOf(harness, taskId);
    expect(timing.needsYou.at(-1)).toEqual({ from: from ?? 0, to: harness.now, answered: true });
    expect(timing.openGates).not.toContain(plan.id);
  });

  test('one wait spans overlapping gates until the last closes, answered by how it closed', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'gate.opened', gate: gate(taskId, 'g1') });
    const from = harness.now;
    harness.replay({ type: 'gate.opened', gate: gate(taskId, 'g1') });
    harness.replay({ type: 'gate.opened', gate: gate(taskId, 'g2') });
    harness.replay({ type: 'gate.answered', gateId: 'g1', decision: 'reply', response: 'Blue' });
    expect(timingOf(harness, taskId)).toMatchObject({ needsYou: [], needsYouSince: from, openGates: ['g2'] });
    harness.replay({ type: 'gate.withdrawn', gateId: 'g2' });
    expect(timingOf(harness, taskId)).toMatchObject({
      needsYou: [{ from, to: harness.now, answered: false }],
      needsYouSince: null,
      openGates: [],
    });
    harness.replay({ type: 'gate.withdrawn', gateId: 'g2' });
    harness.replay({ type: 'gate.withdrawn', gateId: 'missing' });
    expect(timingOf(harness, taskId).needsYou).toHaveLength(1);
  });

  test('a question you answer in the chat counts as answered', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'gate.opened', gate: gate(taskId, 'g1') });
    harness.replay({ type: 'gate.superseded', gateId: 'g1', text: 'Blue, please' });
    expect(timingOf(harness, taskId).needsYou[0]?.answered).toBe(true);
  });

  test('ignores a gate that opens closed and events for a task it does not know', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'gate.opened', gate: { ...gate(taskId, 'g1'), status: 'answered' } });
    harness.replay({ type: 'gate.opened', gate: gate('missing', 'g2') });
    harness.replay({ type: 'task.snooze_changed', taskId: 'missing', snoozed: true });
    expect(harness.task(taskId).timing).toBeUndefined();
  });

  test('replay rebuilds the same timing', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({ type: 'task.snooze', taskId });
    harness.send({ type: 'task.unsnooze', taskId });
    harness.replay({ type: 'gate.opened', gate: gate(taskId, 'g1') });
    expect(replayEventLog(harness.events).state.tasks[taskId]?.timing).toEqual(harness.task(taskId).timing);
  });
});

describe('your inputs', () => {
  test('records each gate you answer with its type and decision, and each message you send', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { planFirst: true });
    proposePlan(harness, taskId);
    const plan = harness.openGate(taskId);
    harness.send({ type: 'gate.answer', gateId: plan.id, decision: 'approve', response: null });
    const approved = harness.now;
    harness.replay({ type: 'task.messaged', taskId, text: 'Use the blue one', kind: 'feedback' });
    const messaged = harness.now;
    harness.replay({ type: 'task.messaged', taskId, text: 'Thanks', kind: 'acknowledge' });
    expect(timingOf(harness, taskId).inputs).toEqual([
      { at: approved, kind: 'gate', gate: 'plan', decision: 'approve' },
      { at: messaged, kind: 'message' },
      { at: harness.now, kind: 'message' },
    ]);
  });

  test('leaves out reviews approved ahead, scheduled, kept and new-work messages, and anything sent for you', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.replay({ type: 'gate.opened', gate: gate(taskId, 'g1') });
    harness.replay({ type: 'gate.answered', gateId: 'g1', decision: 'approve', response: null, ahead: true });
    harness.replay({ type: 'gate.answered', gateId: 'missing', decision: 'approve', response: null });
    harness.replay({ type: 'task.messaged', taskId, text: 'Daily', scheduleId: 'schedule-1' });
    harness.replay({ type: 'task.messaged', taskId, text: 'Kept', kept: true });
    harness.replay({ type: 'task.messaged', taskId, text: 'Next', kind: 'new_round' });
    harness.replay({ type: 'task.messaged', taskId, text: 'Elsewhere', kind: 'separate_task' });
    harness.replay({ type: 'task.messaged', taskId, text: 'From a task', onBehalf: true, byTask: 'other' });
    harness.replay({ type: 'task.messaged', taskId, text: 'From a guest', byGuest: 'guest-1' });
    harness.replay({ type: 'task.messaged', taskId: 'missing', text: 'Lost' });
    expect(timingOf(harness, taskId).inputs).toEqual([]);
  });
});

describe('your presence', () => {
  test('counts what you do yourself per hour', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const before = harness.state.presence[String(resolvePresenceHour(harness.now))] ?? 0;
    harness.send({ type: 'task.snooze', taskId });
    harness.send({ type: 'task.unsnooze', taskId });
    expect(harness.state.presence[String(resolvePresenceHour(harness.now))]).toBe(before + 2);
  });

  test('leaves out what Shinsa, agents and anyone on your behalf do', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const presence = { ...harness.state.presence };
    harness.replay({ type: 'task.staged', taskId, stage: 'planning', reason: 'Planning' });
    harness.send({ type: 'task.snooze', taskId }, { onBehalf: true, byTask: 'other' });
    harness.send(
      { type: 'task.create', request: 'Tidy the docs', repoId: harness.task(taskId).repoId ?? '' },
      { onBehalf: true, byTask: taskId }
    );
    expect(harness.state.presence).toEqual(presence);
  });

  test('keeps a year of hours and drops older ones when a new hour starts', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const first = resolvePresenceHour(harness.now);
    expect(harness.state.presence[String(first)]).toBeGreaterThan(0);
    harness.advance(PRESENCE_RETENTION_HOURS * HOUR_MS - 2 * HOUR_MS);
    harness.send({ type: 'task.snooze', taskId });
    expect(harness.state.presence[String(first)]).toBeGreaterThan(0);
    harness.advance(2 * HOUR_MS);
    harness.send({ type: 'task.unsnooze', taskId });
    expect(harness.state.presence[String(first)]).toBeUndefined();
    expect(Object.keys(harness.state.presence)).toHaveLength(2);
  });
});

describe('time away and focus', () => {
  test('keeps each span you were away from your Mac, without counting it as something you did', () => {
    const harness = createHarness();
    harness.advance(3 * HOUR_MS);
    const presence = { ...harness.state.presence };
    const from = harness.now - 2 * HOUR_MS;
    harness.send({ type: 'away.record', from, to: harness.now - HOUR_MS });
    expect(harness.state.away[String(from)]).toEqual({ from, to: from + HOUR_MS });
    expect(harness.state.presence).toEqual(presence);
  });

  test('refuses a span that ends before it starts, ends later than now or lasts over 30 days', () => {
    const harness = createHarness();
    harness.advance(40 * 24 * HOUR_MS);
    const now = harness.now;
    expect(() => harness.send({ type: 'away.record', from: now - 10, to: now - 10 })).toThrow('Time away');
    expect(() => harness.send({ type: 'away.record', from: now - 10, to: now + 10 })).toThrow('Time away');
    expect(() => harness.send({ type: 'away.record', from: now - 31 * 24 * HOUR_MS, to: now })).toThrow(
      'Time away'
    );
    expect(harness.state.away).toEqual({});
  });

  test('takes time away only from you, never from an agent or a task on your behalf', () => {
    const harness = createHarness();
    harness.advance(HOUR_MS);
    expect(() =>
      harness.send({ type: 'away.record', from: 0, to: harness.now }, { onBehalf: true, byTask: 'other' })
    ).toThrow();
    expect(harness.state.away).toEqual({});
  });

  test('keeps each focus on a project from when it started to when it changed, with its end time', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'paywall-next', 'Superwall');
    const projectId = harness.state.repos[repoId]?.projectId ?? '';
    const started = harness.now + 1;
    harness.send({ type: 'focus.change', projectId, until: started + 8 * HOUR_MS });
    expect(harness.state.focusHistory[String(started)]).toEqual({
      projectIds: [projectId],
      except: false,
      from: started,
      to: null,
      until: started + 8 * HOUR_MS,
    });
    harness.advance(HOUR_MS);
    harness.send({ type: 'focus.change', projectId: null, until: null });
    expect(harness.state.focusHistory[String(started)]?.to).toBe(started + HOUR_MS + 1);
    expect(Object.keys(harness.state.focusHistory)).toEqual([String(started)]);
  });

  test('keeps a focus on all but some projects with the projects it leaves out, and no span for a team', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'paywall-next', 'Superwall');
    const projectId = harness.state.repos[repoId]?.projectId ?? '';
    const started = harness.now + 1;
    harness.send({
      type: 'focus.change',
      projectId: null,
      projectIds: [projectId],
      except: true,
      until: null,
    });
    expect(harness.state.focusHistory[String(started)]).toMatchObject({
      projectIds: [projectId],
      except: true,
    });
    harness.send({ type: 'focus.change', projectId: null, teamId: 'team-1', until: null });
    expect(Object.keys(harness.state.focusHistory)).toEqual([String(started)]);
  });

  test('drops time away and focus that ended over a year ago', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness, 'paywall-next', 'Superwall');
    const projectId = harness.state.repos[repoId]?.projectId ?? '';
    harness.advance(2 * HOUR_MS);
    const old = harness.now - HOUR_MS;
    harness.send({ type: 'away.record', from: old - HOUR_MS, to: old });
    harness.send({ type: 'focus.change', projectId, until: null });
    harness.send({ type: 'focus.change', projectId: null, until: null });
    harness.advance(PRESENCE_RETENTION_HOURS * HOUR_MS);
    const recent = harness.now - HOUR_MS;
    harness.send({ type: 'away.record', from: recent, to: harness.now });
    harness.send({ type: 'focus.change', projectId, until: null });
    expect(Object.keys(harness.state.away)).toEqual([String(recent)]);
    expect(Object.keys(harness.state.focusHistory)).toEqual([String(harness.now)]);
  });
});
