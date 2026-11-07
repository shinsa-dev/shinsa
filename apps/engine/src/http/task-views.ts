import {
  type ChatEntry,
  isGateHeld,
  isTaskSettled,
  isWatchHome,
  listMergeSteps,
  listOpenGates,
  listProjectRepos,
  listWaitsOn,
  type Run,
  type ShinsaState,
  STAGE_WORDS,
  selectTaskByHandle,
  serializeTaskDetail,
  type Task,
} from '@shinsa/core';
import type {
  ChatPage,
  ProjectView,
  RunView,
  TaskDetailView,
  TaskView,
} from '@shinsa/core/engine-api/schema';
import type { TaskFilter } from './routes/tasks/schema.ts';

export interface ChatRequest {
  readonly runId: string | null;
  readonly kinds: ReadonlySet<ChatEntry['type']>;
  readonly limit: number;
  readonly after: number | null;
}

const ACTIVITY_SHOWN = 30;

function selectDecision(state: ShinsaState, task: Task) {
  const gate = listOpenGates(state, task.id)[0];
  return gate ? { gateId: gate.id, type: gate.type, title: gate.title } : null;
}

export function resolveTaskView(state: ShinsaState, task: Task, base: string): TaskView {
  const repo = task.repoId ? state.repos[task.repoId] : undefined;
  const pullRequest = task.pullRequest;
  return {
    id: task.id,
    handle: task.handle ?? null,
    title: task.title,
    stage: task.stage,
    status: STAGE_WORDS[task.stage],
    stageReason: task.stageReason,
    priority: task.priority,
    mode: task.mode ?? 'build',
    repo: repo?.name ?? null,
    branch: task.branch,
    pullRequest: pullRequest
      ? {
          number: pullRequest.number,
          state: pullRequest.state,
          checks: pullRequest.checks,
          url: pullRequest.url,
        }
      : null,
    decision: selectDecision(state, task),
    snoozed: Boolean(task.snoozed),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    url: `${base}/tasks/${task.handle ?? task.id}`,
  };
}

export function isTaskListed(state: ShinsaState, task: Task, filter: TaskFilter) {
  if (isWatchHome(task)) return false;
  if (filter === 'all') return true;
  if (filter === 'settled') return isTaskSettled(task);
  if (isTaskSettled(task)) return false;
  if (filter === 'open') return true;
  return !task.snoozed && listOpenGates(state, task.id).some((gate) => !isGateHeld(state, gate));
}

export function matchesTaskQuery(state: ShinsaState, task: Task, words: readonly string[]) {
  const repo = task.repoId ? (state.repos[task.repoId]?.name ?? '') : '';
  const haystack = [task.id, task.handle ?? '', task.title, task.request, task.branch ?? '', repo]
    .join(' ')
    .toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function listTaskMatches(state: ShinsaState, ref: string): readonly Task[] {
  const exact = state.tasks[ref] ?? selectTaskByHandle(state, ref);
  if (exact) return [exact];
  const lower = ref.toLowerCase();
  return Object.values(state.tasks).filter(
    (task) => task.id.startsWith(ref) || task.title.toLowerCase() === lower
  );
}

export function resolveRunView(run: Run): RunView {
  return {
    id: run.id,
    role: run.role,
    phaseIndex: run.phaseIndex ?? null,
    provider: run.provider,
    model: run.model,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    outcome: run.outcome,
    summary: run.summary,
    account: run.account?.email ?? run.account?.id ?? null,
    delegation: run.delegation
      ? { title: run.delegation.title, parentRunId: run.delegation.parentRunId, depth: run.delegation.depth }
      : null,
  };
}

function listTaskRuns(state: ShinsaState, taskId: string) {
  return Object.values(state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function resolveTaskDetail(state: ShinsaState, task: Task, base: string): TaskDetailView {
  return {
    task: resolveTaskView(state, task, base),
    request: task.request,
    plan: task.plan
      ? {
          version: task.plan.version,
          approved: Boolean(task.plan.approvedAt),
          document: task.plan.document,
        }
      : null,
    summary: task.summary,
    result: task.result ?? null,
    findings: task.findings,
    mergeSteps: listMergeSteps(task),
    watchdogs: task.watchdogs ?? [],
    gates: listOpenGates(state, task.id),
    waitsOn: listWaitsOn(state, task).map((other) => ({ id: other.id, title: other.title })),
    runs: listTaskRuns(state, task.id).map(resolveRunView),
    suggestions: task.suggestions ?? [],
    activity: task.activity.slice(-ACTIVITY_SHOWN),
    text: serializeTaskDetail(state, task.id),
  };
}

export function resolveChatPage(
  transcripts: ReadonlyMap<string, ChatEntry[]>,
  state: ShinsaState,
  task: Task,
  chat: ChatRequest
): ChatPage {
  const runs = listTaskRuns(state, task.id);
  const all = runs
    .filter((run) => !chat.runId || run.id === chat.runId)
    .flatMap((run) => (transcripts.get(run.id) ?? []).map((entry) => ({ ...entry, runId: run.id })))
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => chat.kinds.has(entry.type));
  const page =
    chat.after === null
      ? all.slice(-chat.limit)
      : all.filter((entry) => entry.index > (chat.after ?? -1)).slice(0, chat.limit);
  const last = page.at(-1);
  const more = last !== undefined && all.some((entry) => entry.index > last.index);
  return { taskId: task.id, runs: runs.map(resolveRunView), entries: page, next: more ? last.index : null };
}

export function listProjectViews(state: ShinsaState): ProjectView[] {
  return Object.values(state.projects).map((project) => ({
    ...project,
    repos: listProjectRepos(state, project.id).map((repo) => ({
      id: repo.id,
      name: repo.name,
      path: repo.path,
    })),
  }));
}

export function listActionViews(state: ShinsaState) {
  return (state.onBehalfActions ?? []).map((action) => {
    const from = action.byTaskId ? state.tasks[action.byTaskId] : undefined;
    return { ...action, byTask: from ? (from.handle ?? `“${from.title}”`) : null };
  });
}
