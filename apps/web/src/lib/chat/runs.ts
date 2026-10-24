import type { Evidence, ShinsaState, Task } from '@shinsa/core';

type Runs = ShinsaState['runs'];

type EvidenceRecord = ShinsaState['evidence'];

export function describeEmptyChat(task: Task) {
  if (task.stage === 'triage') {
    return {
      title: 'Shinsa is setting up the task',
      description: 'It picks the repository and a branch, then an agent starts here.',
    };
  }
  if (task.stage === 'queued') {
    return {
      title: 'Not started yet',
      description: 'An agent picks this task up when the task it waits on is finished.',
    };
  }
  return {
    title: 'No agent has run yet',
    description: 'The conversation shows up here once an agent picks up this task.',
  };
}

export function listTaskRuns(runs: Runs, taskId: string) {
  return Object.values(runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function groupEvidenceByRun(evidence: EvidenceRecord, taskId: string) {
  const byRun = new Map<string, Evidence[]>();
  for (const item of Object.values(evidence)) {
    if (item.taskId !== taskId || !item.runId) continue;
    byRun.set(item.runId, [...(byRun.get(item.runId) ?? []), item]);
  }
  return byRun;
}
