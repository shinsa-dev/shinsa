import { type BundlePullRequest, isTaskSettled, type Task, type TaskStage } from '../domain/index.ts';
import {
  listActiveRuns,
  listBundleBelow,
  listOpenGates,
  selectStackedOnThis,
  selectStackParent,
} from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { syncStackBase } from './dependencies.ts';

const READY_REASON = 'ready, merges with its bundle';

const MERGING_REASON = 'merging with its bundle';

const NOT_STARTED: ReadonlySet<TaskStage> = new Set<TaskStage>(['triage', 'waiting_on_tasks']);

const SHIPPED: ReadonlySet<TaskStage> = new Set<TaskStage>(['shipping', 'awaiting_merge']);

function selectMergeGate(decider: Decider, taskId: string) {
  return listOpenGates(decider.state, taskId).find((gate) => gate.type === 'merge') ?? null;
}

function isBundleMerging(decider: Decider, task: Task) {
  return task.stage === 'awaiting_merge' && listOpenGates(decider.state, task.id).length === 0;
}

function resolveBundleTop(decider: Decider, task: Task) {
  const seen = new Set<string>([task.id]);
  let top = task;
  let child = selectStackedOnThis(decider.state, top.id);
  while (child && !seen.has(child.id)) {
    seen.add(child.id);
    top = child;
    child = selectStackedOnThis(decider.state, top.id);
  }
  return top;
}

export function clearBundleReady(decider: Decider, taskId: string) {
  if (!decider.task(taskId).bundleReady) return;
  decider.emit({ type: 'task.bundle_ready', taskId, ready: null });
}

function nudgeBundleTop(decider: Decider, task: Task) {
  const top = resolveBundleTop(decider, task);
  if (top.id === task.id || top.stage !== 'shipping' || top.pushPending) return;
  if (top.pullRequest?.state !== 'open' || listActiveRuns(decider.state, top.id).length > 0) return;
  if (!listBundleBelow(decider.state, top).every((below) => below.bundleReady)) return;
  decider.run({ kind: 'pull_request.watch', taskId: top.id });
}

function markBundleReady(decider: Decider, taskId: string, commit: string | null) {
  decider.withdrawGates(taskId, (gate) => gate.type === 'merge' || gate.type === 'failure');
  decider.progressed(taskId);
  if (decider.task(taskId).bundleReady?.commit !== commit) {
    decider.emit({ type: 'task.bundle_ready', taskId, ready: { commit } });
  }
  decider.stage(taskId, 'shipping', READY_REASON);
  nudgeBundleTop(decider, decider.task(taskId));
}

export function holdInBundle(decider: Decider, task: Task, commit: string | null) {
  if (selectStackedOnThis(decider.state, task.id)) {
    markBundleReady(decider, task.id, commit);
    return true;
  }
  const waiting = listBundleBelow(decider.state, task).filter((below) => !below.bundleReady);
  if (waiting.length === 0) return false;
  decider.withdrawGates(task.id, (gate) => gate.type === 'merge');
  decider.stage(task.id, 'shipping', `waiting for ${quoteTitles(waiting)} to be ready to merge`);
  return true;
}

export function keepsBundleReady(task: Task, commit: string | null, clean: boolean) {
  if (!task.bundleReady) return false;
  return clean && task.bundleReady.commit === commit;
}

export function describeBundleMerge(state: Decider['state'], task: Task) {
  const below = listBundleBelow(state, task);
  if (below.length === 0) return null;
  const pullRequests = [task, ...below]
    .map((member) => (member.pullRequest ? `#${member.pullRequest.number} “${member.title}”` : null))
    .filter(Boolean)
    .join(', ');
  return `Approving merges the whole bundle, top down: ${pullRequests}.`;
}

export function startBundleMerge(decider: Decider, taskId: string): BundlePullRequest[] {
  const bundle: BundlePullRequest[] = [];
  for (const below of listBundleBelow(decider.state, decider.task(taskId))) {
    if (!below.pullRequest) continue;
    decider.stage(below.id, 'awaiting_merge', MERGING_REASON);
    bundle.push({ taskId: below.id, number: below.pullRequest.number });
  }
  return bundle;
}

function recheck(decider: Decider, taskId: string) {
  decider.stage(taskId, 'shipping', 'checking the pull request');
  decider.run({ kind: 'pull_request.watch', taskId });
}

function reviewReadiness(decider: Decider, task: Task) {
  const child = selectStackedOnThis(decider.state, task.id);
  const gate = selectMergeGate(decider, task.id);
  if (child && gate) {
    markBundleReady(decider, task.id, gate.commit ?? null);
    return;
  }
  if (task.bundleReady && !SHIPPED.has(task.stage)) {
    clearBundleReady(decider, task.id);
    return;
  }
  if (!child && task.bundleReady && task.stage === 'shipping') {
    clearBundleReady(decider, task.id);
    recheck(decider, task.id);
    return;
  }
  if (child && isBundleMerging(decider, task) && !isBundleMerging(decider, resolveBundleTop(decider, task))) {
    decider.stage(task.id, 'shipping', READY_REASON);
    return;
  }
  if (!child && gate) holdInBundle(decider, task, gate.commit ?? null);
}

function reviewStackParent(decider: Decider, task: Task) {
  if (NOT_STARTED.has(task.stage)) return;
  const parent = selectStackParent(decider.state, task);
  if (parent?.stage === 'cancelled') {
    if (listOpenGates(decider.state, task.id).length > 0) return;
    decider.fail(
      task.id,
      `“${parent.title}” was cancelled`,
      'This task was stacked on it as a bundle. Retry to take it out of the bundle and base its pull request on the default branch, or cancel this one.'
    );
    return;
  }
  if (!task.stackBase) return;
  const base = task.stackBase;
  syncStackBase(decider, task.id);
  const moved = decider.task(task.id);
  if (moved.stackBase !== base && SHIPPED.has(moved.stage) && moved.pullRequest) {
    decider.run({ kind: 'pull_request.watch', taskId: task.id });
  }
}

function isBundled(task: Task, parents: ReadonlySet<string>) {
  return Boolean(task.stacksOn || task.stackBase || task.bundleReady || parents.has(task.id));
}

export function reviewBundles(decider: Decider) {
  const tasks = Object.values(decider.state.tasks);
  const parents = new Set(tasks.flatMap((task) => (task.stacksOn ? [task.stacksOn] : [])));
  for (const { id } of tasks) {
    const task = decider.task(id);
    if (isTaskSettled(task) || !isBundled(task, parents)) continue;
    reviewReadiness(decider, task);
    reviewStackParent(decider, decider.task(id));
  }
}
