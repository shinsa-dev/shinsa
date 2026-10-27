import { describe, expect, test } from 'bun:test';
import type { ReportWalkthrough } from '../../src/index.ts';
import { assembleReport } from '../../src/report/index.ts';
import { buildAll, completePhase, createHarness, createTask, PASSING, proposePlan } from '../harness.ts';

const WALKTHROUGH: ReportWalkthrough = {
  approach: 'Clamp it.',
  flow: 'a → b',
  risks: [],
  testing: { automated: [], manual: [] },
};

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

  test('takes the walkthrough of the latest phase that wrote one', () => {
    const harness = createHarness();
    const taskId = createTask(harness);
    proposePlan(harness, taskId);
    expect(assembleReport(harness.task(taskId)).walkthrough).toBeNull();
    const at = harness.task(taskId).createdAt;
    const phase = (index: number, walkthrough: ReportWalkthrough | null) => ({
      index,
      summary: `Phase ${index + 1}.`,
      spots: [],
      judgementCalls: [],
      walkthrough,
      at,
    });
    const task = {
      ...harness.task(taskId),
      phaseReports: [phase(1, null), phase(0, { ...WALKTHROUGH, approach: 'Old.' }), phase(2, WALKTHROUGH)],
    };
    expect(assembleReport(task).walkthrough).toEqual(WALKTHROUGH);
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
