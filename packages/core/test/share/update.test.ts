import { describe, expect, test } from 'bun:test';
import type { Watchdog } from '../../src/domain/watchdogs.ts';
import type { Task, TaskStage } from '../../src/index.ts';
import { resolveShareUpdate } from '../../src/index.ts';

function task(stage: TaskStage, extra: Partial<Task> = {}) {
  return { stage, pullRequest: null, watchdogs: [], ...extra } as unknown as Task;
}

const MERGED = { pullRequest: { state: 'merged' } } as unknown as Partial<Task>;

function watchdog(status: Watchdog['status']) {
  return { status } as Watchdog;
}

describe('a status link’s update', () => {
  test('follows the work from planning to ready for release', () => {
    expect(resolveShareUpdate(task('triage'))).toBe('planning');
    expect(resolveShareUpdate(task('awaiting_plan'))).toBe('planning');
    expect(resolveShareUpdate(task('building'))).toBe('working');
    expect(resolveShareUpdate(task('fixing'))).toBe('working');
    expect(resolveShareUpdate(task('awaiting_review'))).toBe('ready');
    expect(resolveShareUpdate(task('awaiting_merge'))).toBe('ready');
    expect(resolveShareUpdate(task('investigating'))).toBe('looking_into');
    expect(resolveShareUpdate(task('answered'))).toBe('answered');
    expect(resolveShareUpdate(task('cancelled'))).toBe('closed');
  });

  test('says live once merged, but deploying while a watchdog still waits for production', () => {
    expect(resolveShareUpdate(task('merged'))).toBe('live');
    expect(resolveShareUpdate(task('merged', { watchdogs: [watchdog('awaiting_production')] }))).toBe(
      'deploying'
    );
    expect(resolveShareUpdate(task('watching', { ...MERGED, watchdogs: [watchdog('watching')] }))).toBe(
      'live'
    );
    expect(resolveShareUpdate(task('done', MERGED))).toBe('live');
    expect(
      resolveShareUpdate(task('done', { ...MERGED, watchdogs: [watchdog('awaiting_production')] }))
    ).toBe('deploying');
  });

  test('a task done without a merged pull request is done, not live', () => {
    expect(resolveShareUpdate(task('done'))).toBe('done');
    expect(resolveShareUpdate(task('watching'))).toBe('looking_into');
  });
});
