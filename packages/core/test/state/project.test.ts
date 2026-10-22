import { describe, expect, test } from 'bun:test';
import { applyEvent, createState, resolveFallbackBriefing, type ShinsaEventInput } from '../../src/index.ts';
import { NOW, queueOf, ready } from '../briefing/fixtures.ts';
import { buildAll, createHarness, createTask, pullRequest, reachShipping } from '../harness.ts';

describe('briefing events', () => {
  test('store the structured guide, and replay older text-only events', () => {
    const guide = resolveFallbackBriefing(queueOf(ready), NOW);
    const withGuide = applyEvent(createState(), {
      type: 'briefing.written',
      areaId: null,
      text: 'Start with the chat.',
      briefing: guide,
      seq: 1,
      at: NOW,
    });
    expect(withGuide.briefings['*']).toEqual({ text: 'Start with the chat.', at: NOW, briefing: guide });
    const legacy = applyEvent(createState(), {
      type: 'briefing.written',
      areaId: 'area-1',
      text: 'Start with the chat.',
      seq: 1,
      at: NOW,
    });
    expect(legacy.briefings['area-1']).toEqual({ text: 'Start with the chat.', at: NOW, briefing: null });
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
      results: [{ name: 'lint', outcome: 'pass', detail: null }],
    });
    const checks = harness
      .task(taskId)
      .activity.filter((entry) => entry.actor === 'shinsa' && entry.kind === 'review');
    expect(checks.map((entry) => entry.text)).toEqual(['The check passed']);
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
        report: { index: 0, summary: '', spots: [], decisions: [], at },
      },
      { type: 'gate.answered', gateId: 'x', decision: 'approve', response: null },
      { type: 'run.linked', runId: 'x', sessionId: 's' },
    ];
    for (const event of events) {
      applyEvent(state, { ...event, seq: state.seq + 1, at });
    }
    expect(state).toEqual({ ...createState(), seq: 6 });
  });
});
