import { describe, expect, test } from 'bun:test';
import {
  applyEvent,
  createSettings,
  createState,
  replaceBriefing,
  replayEventLog,
  resolveFallbackBriefing,
  type ShinsaEvent,
  type ShinsaEventInput,
} from '../../src/index.ts';
import { NOW, queueOf, ready } from '../briefing/fixtures.ts';
import {
  buildAll,
  createHarness,
  createTask,
  pullRequest,
  reachReviewGate,
  reachShipping,
} from '../harness.ts';

describe('briefings', () => {
  test('replacing one stores the guide per project and leaves the state it came from as it was', () => {
    const guide = resolveFallbackBriefing(queueOf(ready), NOW);
    const empty = createState();
    const withGuide = replaceBriefing(empty, null, {
      text: 'Start with the chat.',
      at: NOW,
      briefing: guide,
    });
    expect(withGuide.briefings['*']).toEqual({ text: 'Start with the chat.', at: NOW, briefing: guide });
    expect(empty.briefings).toEqual({});
    const both = replaceBriefing(withGuide, 'project-1', { text: 'Plain.', at: NOW, briefing: null });
    expect(Object.keys(both.briefings)).toEqual(['*', 'project-1']);
    expect(both.tasks).toBe(withGuide.tasks);
  });
});

describe('settings events', () => {
  test('a settings event is taken as written', () => {
    const settings = {
      ...createSettings(),
      compaction: 'provider' as const,
      idleCompaction: true,
      fastMode: false,
    };
    const state = applyEvent(createState(), { type: 'settings.changed', settings, seq: 1, at: NOW });
    expect(state.settings).toEqual(settings);
    settings.fastMode = true;
    expect(state.settings.fastMode).toBe(false);
  });
});

describe('task activity', () => {
  test('records a stage when the stage changes, not every time its reason does', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachShipping(harness, taskId);
    harness.send({ type: 'pull_request.record', taskId, pullRequest: pullRequest({ checks: 'pending' }) });
    const texts = harness
      .task(taskId)
      .activity.filter((entry) => entry.kind === 'stage')
      .map((entry) => entry.text);
    expect(texts.filter((text) => text === 'Building started')).toHaveLength(1);
    expect(texts.filter((text) => text === 'Opening the pull request')).toHaveLength(1);
  });

  test('says how the checks went, in words that fit the count', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({
      type: 'checks.record',
      taskId,
      results: [{ id: 'r1', label: 'bun lint', command: 'bun lint', outcome: 'pass', detail: null }],
    });
    const checks = harness
      .task(taskId)
      .activity.filter((entry) => entry.actor === 'shinsa' && entry.kind === 'check');
    expect(checks.map((entry) => entry.text)).toEqual(['The check passed']);
  });

  test('says how many findings the agent review ranked blocking and should fix', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const finding = (severity: 'blocking' | 'should_fix' | 'optional') => ({
      severity,
      file: 'a.ts',
      line: 1,
      message: 'Look.',
    });
    const texts = [
      [],
      [finding('optional')],
      [finding('should_fix'), finding('should_fix'), finding('optional')],
      [finding('blocking'), finding('should_fix')],
    ].map((findings, index) => {
      const state = applyEvent(harness.state, {
        type: 'review.reported',
        taskId,
        summary: null,
        findings,
        seq: harness.state.seq + 1,
        at: index + 1,
      });
      return state.tasks[taskId]?.activity.at(-1)?.text;
    });
    expect(texts).toEqual([
      'Agent review found nothing',
      'Agent review found 1 issue',
      'Agent review found 3 issues, 2 should fix',
      'Agent review found 2 issues, 1 blocking, 1 should fix',
    ]);
  });

  test('keeps the last 200 entries', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    const runId = harness.activeRun(taskId).id;
    for (let index = 0; index < 210; index += 1)
      harness.send({ type: 'agent.note', runId, note: `Note ${index}` });
    const activity = harness.task(taskId).activity;
    expect(activity).toHaveLength(200);
    expect(activity.at(-1)?.text).toBe('Note 209');
  });

  test('events about things that do not exist change nothing', () => {
    const state = createState();
    const at = 0;
    const events: ShinsaEventInput[] = [
      { type: 'task.staged', taskId: 'x', stage: 'planning', reason: 'r' },
      { type: 'task.messaged', taskId: 'x', text: 'hi' },
      { type: 'phase.updated', taskId: 'x', index: 0, status: 'done' },
      {
        type: 'phase.completed',
        taskId: 'x',
        report: { index: 0, summary: '', spots: [], judgementCalls: [], at },
      },
      { type: 'walkthrough.revised', taskId: 'x', walkthrough: { flow: 'f' }, runId: 'x' },
      { type: 'gate.answered', gateId: 'x', decision: 'approve', response: null },
      { type: 'run.linked', runId: 'x', sessionId: 's', provider: 'claude' },
    ];
    for (const event of events) {
      applyEvent(state, { ...event, seq: state.seq + 1, at });
    }
    expect(state).toEqual({ ...createState(), seq: 7 });
  });
});

describe('replayEventLog', () => {
  test('applies every event it can, reports the ones it cannot, and keeps the highest sequence', () => {
    const events = [
      { type: 'focus.changed', focus: { projectId: null, until: 5 }, seq: 1, at: 1 },
      { type: 'task.suggested', seq: 2, at: 2 },
      { type: 'focus.changed', focus: { projectId: null, until: 9 }, seq: 3, at: 3 },
      { type: 'task.suggested', seq: 4, at: 4 },
    ] as unknown as ShinsaEvent[];
    const { state, failures } = replayEventLog(events);
    expect(state.focus.until).toBe(9);
    expect(state.seq).toBe(4);
    expect(failures.map((failure) => [failure.seq, failure.type])).toEqual([
      [2, 'task.suggested'],
      [4, 'task.suggested'],
    ]);
    expect(failures[0]?.error).toContain('undefined');
  });
});

function apply(events: ShinsaEventInput[]) {
  let state = createState();
  events.forEach((event, index) => {
    state = applyEvent(state, { ...event, seq: index + 1, at: index + 1 } as ShinsaEvent);
  });
  return state;
}

describe('applying the process events', () => {
  test('events about a task, run, gate or monitor that is not there change nothing', () => {
    const state = apply([
      {
        type: 'run.metered',
        runId: 'r',
        usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 1 },
      },
      { type: 'run.silenced', runId: 'r', since: 1 },
      { type: 'monitor.fired', taskId: 't', monitorId: 'm', attempt: 1 },
      { type: 'monitor.ended', taskId: 't', monitorId: 'm', status: 'cleared' },
      { type: 'suggestion.settled', taskId: 't', suggestionId: 's', status: 'accepted', createdTaskId: null },
      { type: 'plan.approved', taskId: 't', version: 1 },
      { type: 'gate.superseded', gateId: 'g', text: 'x' },
    ]);
    expect(state.tasks).toEqual({});
    expect(state.runs).toEqual({});
    expect(state.gates).toEqual({});
  });

  test('approving an older version leaves the current plan unapproved', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    harness.send({
      type: 'agent.propose_plan',
      runId: harness.activeRun(taskId).id,
      document: {
        goal: 'G',
        phases: [
          { title: 'A', detail: 'a' },
          { title: 'B', detail: 'b' },
        ],
        behaviour: [],
        approach: 'x',
        files: [],
        outOfScope: [],
        verification: [{ label: 'Tests', command: 'bun test src/a', phases: [1] }],
        questions: [],
      },
    });
    const state = applyEvent(structuredClone(harness.state), {
      type: 'plan.approved',
      taskId,
      version: 9,
      seq: harness.state.seq + 1,
      at: 1,
    });
    expect(state.tasks[taskId]?.plan?.approvedAt).toBeUndefined();
  });

  test('dismissing a finding again keeps one copy of it', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    reachReviewGate(harness, taskId);
    const findings = [{ severity: 'optional' as const, file: 'a.ts', line: 1, message: 'Rename.' }];
    const base = structuredClone(harness.state);
    const task = base.tasks[taskId];
    if (!task) throw new Error('no task');
    base.tasks[taskId] = {
      ...task,
      findings,
      dismissedFindings: [{ ...findings[0], verdict: 'dismiss' } as never],
    };
    const gateId = harness.openGate(taskId).id;
    const state = applyEvent(base, {
      type: 'gate.answered',
      gateId,
      decision: 'approve',
      response: null,
      verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
      seq: base.seq + 1,
      at: 1,
    });
    expect(state.tasks[taskId]?.dismissedFindings).toHaveLength(1);
  });

  test('verdicts for a gate whose task is gone are kept on the gate only', () => {
    const state = apply([
      {
        type: 'gate.opened',
        gate: {
          id: 'g',
          taskId: 'gone',
          type: 'review',
          status: 'open',
          title: 'x',
          body: '',
          runId: null,
          openedAt: 0,
          answeredAt: null,
          decision: null,
          response: null,
        },
      },
      {
        type: 'gate.answered',
        gateId: 'g',
        decision: 'approve',
        response: null,
        verdicts: [{ index: 0, verdict: 'dismiss', note: null }],
      },
    ]);
    expect(state.gates.g?.verdicts).toHaveLength(1);
  });
});

describe('cancelling', () => {
  function stageTask(
    taskId: string,
    state: ReturnType<typeof createHarness>['state'],
    stage: 'cancelled' | 'planning'
  ) {
    return applyEvent(state, {
      type: 'task.staged',
      taskId,
      stage,
      reason: stage,
      seq: state.seq + 1,
      at: NOW,
    }).tasks[taskId];
  }

  test('a cancelled task keeps the stage it stopped at, once, and forgets it when it moves on', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    expect(stageTask(taskId, harness.state, 'planning')).not.toHaveProperty('cancelledFrom');
    expect(stageTask(taskId, harness.state, 'cancelled')?.cancelledFrom).toBe('planning');
    expect(stageTask(taskId, harness.state, 'cancelled')?.cancelledFrom).toBe('planning');
    expect(stageTask(taskId, harness.state, 'planning')?.cancelledFrom).toBeNull();
  });
});
