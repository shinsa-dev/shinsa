import { describe, expect, test } from 'bun:test';
import {
  countFixRepeats,
  countReviewRounds,
  countUnchangedRounds,
  resolveRecoveryFingerprint,
} from '../../src/decide/fingerprints.ts';
import type { Task } from '../../src/index.ts';
import { buildAll, createHarness, createTask, failing, pullRequest } from '../harness.ts';

function builtTask(): Task {
  const harness = createHarness();
  const taskId = createTask(harness);
  buildAll(harness, taskId);
  return harness.task(taskId);
}

describe('recovery fingerprints', () => {
  test('come from durable state only, in a stable order, so prose never changes them', () => {
    const task = builtTask();
    expect(task.phaseReports.length).toBeGreaterThan(1);
    const base = resolveRecoveryFingerprint(task);
    expect(base).toMatch(/^recovery:[0-9a-f]{8}$/);
    const shuffled = { ...task, phaseReports: [...task.phaseReports].reverse(), summary: 'Different words.' };
    expect(resolveRecoveryFingerprint(shuffled)).toBe(base);
    const checks = { ...task, checkResults: [...failing('b'), ...failing('a')] };
    const reordered = { ...task, checkResults: [...failing('a'), ...failing('b')] };
    expect(resolveRecoveryFingerprint(checks)).toBe(resolveRecoveryFingerprint(reordered));
    expect(resolveRecoveryFingerprint(checks)).not.toBe(base);
    expect(resolveRecoveryFingerprint({ ...task, treeHash: 't-2' })).not.toBe(base);
    expect(resolveRecoveryFingerprint({ ...task, pullRequest: pullRequest() })).not.toBe(base);
    const finding = { severity: 'blocking' as const, file: 'a.ts', line: 1, message: 'x' };
    expect(resolveRecoveryFingerprint({ ...task, findings: [finding] })).not.toBe(base);
    expect(resolveRecoveryFingerprint({ ...task, findings: [{ ...finding, verdict: 'dismiss' }] })).toBe(
      base
    );
    expect(
      resolveRecoveryFingerprint({ ...task, findings: [{ ...finding, file: null, line: null }] })
    ).not.toBe(base);
  });

  test('fix repeats match the reason and either the signature or the unchanged tree', () => {
    const task = builtTask();
    const fingerprints = [
      { reason: 'checks' as const, signature: 'lint', treeHash: 't-1' },
      { reason: 'review' as const, signature: 'a.ts', treeHash: 't-2' },
    ];
    const tracked = { ...task, fixFingerprints: fingerprints, treeHash: 't-1' };
    expect(countFixRepeats(tracked, 'checks', 'lint')).toBe(1);
    expect(countFixRepeats(tracked, 'checks', 'other')).toBe(1);
    expect(countFixRepeats({ ...tracked, treeHash: 't-9' }, 'checks', 'other')).toBe(0);
    expect(countFixRepeats({ ...tracked, treeHash: null }, 'checks', null)).toBe(0);
    expect(countUnchangedRounds(tracked, 'checks')).toBe(1);
    expect(countUnchangedRounds({ ...tracked, treeHash: null }, 'checks')).toBe(0);
    expect(countReviewRounds(tracked)).toBe(1);
  });

  test('a task from before fingerprints counts from its fix history', () => {
    const task = { ...builtTask(), fixFingerprints: undefined, fixHistory: ['review:a.ts', 'checks:lint'] };
    expect(countFixRepeats(task, 'review', 'a.ts')).toBe(1);
    expect(countFixRepeats(task, 'review', null)).toBe(0);
    expect(countReviewRounds(task)).toBe(1);
    expect(countUnchangedRounds(task, 'review')).toBe(0);
  });
});
