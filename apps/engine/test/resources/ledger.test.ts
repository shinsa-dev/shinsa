import { expect, test } from 'bun:test';
import { ProcessLedger } from '../../src/resources/ledger.ts';

test('the ledger keeps tracked roots until released and adds the running services', () => {
  const ledger = new ProcessLedger(() => [{ taskId: 'task-a', pid: 30 }]);
  const release = ledger.track('task-a', 'agent', 10);
  const releaseCheck = ledger.track('task-b', 'checks', 20);
  expect(ledger.listRoots()).toEqual([
    { taskId: 'task-a', kind: 'agent', pid: 10 },
    { taskId: 'task-b', kind: 'checks', pid: 20 },
    { taskId: 'task-a', kind: 'services', pid: 30 },
  ]);
  const reused = ledger.track('task-c', 'checks', 20);
  releaseCheck();
  release();
  expect(new ProcessLedger().listRoots()).toEqual([]);
  expect(ledger.listRoots().map((root) => root.taskId)).toEqual(['task-c', 'task-a']);
  reused();
  expect(ledger.listRoots()).toHaveLength(1);
});
