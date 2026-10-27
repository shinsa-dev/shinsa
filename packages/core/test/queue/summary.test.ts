import { describe, expect, test } from 'bun:test';
import { resolveQueueSummary } from '../../src/index.ts';
import {
  createHarness,
  createTask,
  reachReviewGate,
  reachShipping,
  registerRepo,
  verifySetup,
} from '../harness.ts';

describe('resolveQueueSummary', () => {
  test('lists decisions and working tasks with links by handle, and the guide as one paragraph', () => {
    const harness = createHarness();
    const review = createTask(harness, { request: 'Review me' });
    reachReviewGate(harness, review);
    const paused = createTask(harness, { request: 'Pause me' });
    harness.send({ type: 'effect.fail', taskId: paused, title: 'Broke', detail: 'x' });
    const working = createTask(harness, { request: 'Plan me' });
    const summary = resolveQueueSummary(harness.state, 0, 'http://localhost:5180');
    expect(summary.decisions).toEqual([
      {
        taskId: review,
        handle: 'SUP-1',
        title: 'Review me',
        label: 'Review',
        kind: 'review',
        url: 'http://localhost:5180/tasks/SUP-1',
      },
      {
        taskId: paused,
        handle: 'SUP-2',
        title: 'Pause me',
        label: 'Paused',
        kind: 'failure',
        url: 'http://localhost:5180/tasks/SUP-2',
      },
    ]);
    expect(summary.working).toEqual([
      {
        taskId: working,
        handle: 'SUP-3',
        title: 'Plan me',
        label: 'planning',
        kind: 'planning',
        url: 'http://localhost:5180/tasks/SUP-3',
      },
    ]);
    expect(summary.briefing).toStartWith('Start with “Review me”: built and checked');
  });

  test('a task that has no handle yet is linked by its id', () => {
    const harness = createHarness();
    harness.send({ type: 'task.create', request: 'Sort this out', repoId: null });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    const summary = resolveQueueSummary(harness.state, 0, 'http://localhost:5180');
    expect(summary.working.map((entry) => entry.url)).toEqual([`http://localhost:5180/tasks/${taskId}`]);
    expect(summary.working.map((entry) => entry.handle)).toEqual([null]);
  });

  test('a task whose setup needs fixing is listed as paused', () => {
    const harness = createHarness();
    const repoId = registerRepo(harness);
    harness.send({ type: 'task.create', request: 'Set me up', repoId });
    const taskId = Object.keys(harness.state.tasks)[0] ?? '';
    harness.send({
      type: 'task.triage',
      taskId,
      title: 'Set me up',
      repoId,
      size: 'small',
      branch: 'fix/setup',
      waitsOn: [],
    });
    verifySetup(harness, taskId, [{ kind: 'default_branch', detail: 'No main.' }]);
    const summary = resolveQueueSummary(harness.state, 0, 'http://localhost:5180');
    expect(summary.decisions.map((decision) => decision.label)).toEqual(['Paused']);
  });

  test('a working task is labelled in words, not by its stage name', () => {
    const harness = createHarness();
    const taskId = createTask(harness, { request: 'Ship me' });
    reachShipping(harness, taskId);
    const summary = resolveQueueSummary(harness.state, 0, 'http://localhost:5180');
    expect(summary.working.map((entry) => entry.label)).toEqual(['pull request open']);
  });
});
