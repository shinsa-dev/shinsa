import type { Evidence, Repo, ReviewPayload, ShinsaState, Task } from '@shinsa/core';
import { createSampleState, createSampleTask } from '@/routes/ui/samples.ts';

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

export const OPEN_TASK_ID = 'open-pull-request';

export const OPEN_REPO_ID = 'open-repository';

const REPO_CHECK = /^r\d+$/;

function createOpenRepo(payload: ReviewPayload): Repo | null {
  const { repo, slug } = payload.task;
  if (!repo) return null;
  return {
    id: OPEN_REPO_ID,
    name: repo,
    path: slug ?? repo,
    defaultBranch: 'main',
    remote: slug ? `github.com/${slug}` : null,
    projectId: null,
    checkCommands: [],
  };
}

function createOpenPullRequest(payload: ReviewPayload, now: number): Task['pullRequest'] {
  const { pullRequest, slug } = payload.task;
  if (!pullRequest || !slug) return null;
  return {
    number: pullRequest,
    url: `https://github.com/${slug}/pull/${pullRequest}`,
    state: 'open',
    checks: 'none',
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: now,
  };
}

export function createOpenState(payload: ReviewPayload, now: number): { state: ShinsaState; task: Task } {
  const repo = createOpenRepo(payload);
  const task = createSampleTask(now, {
    id: OPEN_TASK_ID,
    handle: payload.task.handle,
    title: payload.task.title,
    summary: payload.task.summary,
    stage: payload.task.stage,
    stageReason: 'pull request open',
    createdAt: payload.task.startedAt ?? now,
    pipeline: payload.review
      ? ['plan', 'build', 'checks', 'agent_review', 'your_review', 'pull_request', 'merge']
      : ['plan', 'build', 'checks', 'your_review', 'pull_request', 'merge'],
    reviewSummary: payload.review?.summary ?? null,
    findings: payload.review?.findings ?? [],
    report: payload.report,
    checkResults: payload.report.checks,
    checks: payload.report.checks.map((check) => ({
      id: check.id,
      label: check.label,
      command: check.command,
      phases: [],
      source: REPO_CHECK.test(check.id) ? 'repo' : 'plan',
    })),
    request: '',
    branch: payload.task.branch,
    coverage: payload.task.coverage
      ? { status: 'measured', command: '', files: [], ...payload.task.coverage }
      : null,
    repoId: repo ? repo.id : null,
    pullRequest: createOpenPullRequest(payload, now),
  });
  const base = createSampleState({ tasks: [task] });
  const evidence = Object.fromEntries(toEvidence(payload, now).map((piece) => [piece.id, piece]));
  const repos = repo ? { ...base.repos, [repo.id]: repo } : base.repos;
  return { task, state: { ...base, repos, evidence } };
}
