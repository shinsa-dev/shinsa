import type { Evidence, ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { createSampleState, createSampleTask } from '@/routes/ui/samples.ts';
import { OPEN_TASK_ID } from './demo-repo.ts';

function toEvidence(payload: ReviewPayload, now: number): Evidence[] {
  return payload.evidence.map((piece, index) => ({
    id: piece.id,
    taskId: OPEN_TASK_ID,
    runId: null,
    kind: piece.kind,
    title: piece.title,
    uri: piece.url,
    attachedAt: now - (payload.evidence.length - index),
    itemId: piece.itemId,
    ...(piece.detail ? { detail: piece.detail } : {}),
    ...(piece.width ? { width: piece.width } : {}),
    ...(piece.theme ? { theme: piece.theme } : {}),
    ...(piece.stage ? { stage: piece.stage } : {}),
    ...(piece.label ? { label: piece.label } : {}),
  }));
}

export function createOpenState(payload: ReviewPayload, now: number): { state: ShinsaState; task: Task } {
  const task = createSampleTask(now, {
    id: OPEN_TASK_ID,
    handle: payload.task.handle,
    title: payload.task.title,
    summary: payload.task.summary,
    stage: 'shipping',
    stageReason: 'pull request open',
    pipeline: ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge'],
    report: payload.report,
    checkResults: payload.report.checks,
    repoId: null,
    pullRequest: null,
  });
  const base = createSampleState({ tasks: [task] });
  const evidence = Object.fromEntries(toEvidence(payload, now).map((piece) => [piece.id, piece]));
  return { task, state: { ...base, evidence } };
}
