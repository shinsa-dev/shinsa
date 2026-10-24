import { describe, expect, test } from 'bun:test';
import { assembleReport } from '../../src/report/index.ts';
import { buildAll, completePhase, createHarness, createTask, PASSING, proposePlan } from '../harness.ts';

describe('assembleReport', () => {
  test('builds the review from every phase in plan order, with the checks Shinsa ran', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    buildAll(harness, taskId);
    harness.send({ type: 'checks.record', taskId, results: PASSING });
    const report = assembleReport(harness.task(taskId));
    expect(report.headline).toBe('Ship it.');
    expect(report.sections.map((section) => `${section.title}: ${section.summary}`)).toEqual([
      'Find the overflow: Phase 1 done.',
      'Fix and verify: Phase 2 done.',
    ]);
    expect(report.checks).toEqual(PASSING);
  });

  test('without a plan, each phase is a numbered section and the title is the headline', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    completePhase(harness, taskId, 'Found it.');
    const task = { ...harness.task(taskId), plan: null };
    expect(assembleReport(task)).toMatchObject({
      headline: task.title,
      sections: [{ title: 'Phase 1', summary: 'Found it.' }],
      checks: [],
    });
  });
});
