import { describe, expect, test } from 'bun:test';
import { resolveQueueSummary } from '../../src/index.ts';
import { createHarness, createTask, reachReviewGate } from '../harness.ts';

describe('resolveQueueSummary', () => {
  test('lists decisions and working tasks with links, and the guide as one paragraph', () => {
    const harness = createHarness();
    const review = createTask(harness, { intent: 'Review me' });
    reachReviewGate(harness, review);
    const paused = createTask(harness, { intent: 'Pause me' });
    harness.send({ type: 'effect.fail', taskId: paused, title: 'Broke', detail: 'x' });
    const working = createTask(harness, { intent: 'Plan me' });
    const summary = resolveQueueSummary(harness.state, 0, 'http://localhost:5180');
    expect(summary.decisions).toEqual([
      { taskId: review, title: 'Review me', label: 'Review', url: `http://localhost:5180/tasks/${review}` },
      { taskId: paused, title: 'Pause me', label: 'Paused', url: `http://localhost:5180/tasks/${paused}` },
    ]);
    expect(summary.working).toEqual([
      { taskId: working, title: 'Plan me', label: 'planning', url: `http://localhost:5180/tasks/${working}` },
    ]);
    expect(summary.briefing).toStartWith('Start with “Review me”: built and checked');
  });
});
