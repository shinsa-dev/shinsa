import { expect, test } from 'bun:test';
import { run } from '../terminals/harness.ts';
import { createMonitor } from './harness.ts';

test('the ledger keeps tracked roots until released and adds the running services', async () => {
  const { ledger, close } = createMonitor({ services: [{ taskId: 'task-a', pid: 30 }] });
  const track = (taskId: string, kind: 'agent' | 'checks', pid: number) =>
    run(ledger.track(taskId, kind, pid));
  const roots = () => run(ledger.listRoots);
  const release = track('task-a', 'agent', 10);
  const releaseCheck = track('task-b', 'checks', 20);
  expect(roots()).toEqual([
    { taskId: 'task-a', kind: 'agent', pid: 10 },
    { taskId: 'task-b', kind: 'checks', pid: 20 },
    { taskId: 'task-a', kind: 'services', pid: 30 },
  ]);
  const reused = track('task-c', 'checks', 20);
  run(releaseCheck);
  run(release);
  expect(run(createMonitor().ledger.listRoots)).toEqual([]);
  expect(roots().map((root) => root.taskId)).toEqual(['task-c', 'task-a']);
  run(reused);
  expect(roots()).toHaveLength(1);
  await close();
});
