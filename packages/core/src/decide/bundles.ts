import {
  type BundleConflict,
  type BundlePullRequest,
  isTaskSettled,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import {
  listActiveRuns,
  listBundleAbove,
  listBundleBelow,
  listOpenGates,
  resolveBundleRoot,
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

export function clearBundleReady(decider: Decider, taskId: string) {
  if (!decider.task(taskId).bundleReady) return;
  decider.emit({ type: 'task.bundle_ready', taskId, ready: null });
}

function nudgeBundleRoot(decider: Decider, task: Task) {
  const root = resolveBundleRoot(decider.state, task);
  if (root.id === task.id || root.stage !== 'shipping' || root.pushPending) return;
  if (root.pullRequest?.state !== 'open' || listActiveRuns(decider.state, root.id).length > 0) return;
  if (!listBundleAbove(decider.state, root).every((above) => above.bundleReady)) return;
  decider.run({ kind: 'pull_request.watch', taskId: root.id });
}

function markBundleReady(decider: Decider, taskId: string, commit: string | null) {
  decider.withdrawGates(taskId, (gate) => gate.type === 'failure');
  decider.progressed(taskId);
  if (decider.task(taskId).bundleReady?.commit !== commit) {
    decider.emit({ type: 'task.bundle_ready', taskId, ready: { commit } });
  }
}

function describeConflictHold(decider: Decider, conflict: BundleConflict) {
  const conflicting = decider.state.tasks[conflict.taskId];
  const behind = conflict.behindTaskId ? decider.state.tasks[conflict.behindTaskId] : null;
  const what = `“${conflicting?.title ?? 'A task'}” conflicts with ${conflict.base} once the bundle merges`;
  return behind ? `${what}; updating “${behind.title}” first` : what;
}

function holdBundleRoot(decider: Decider, task: Task) {
  const waiting = listBundleAbove(decider.state, task).filter((above) => !above.bundleReady);
  const conflict = task.bundleConflict ?? null;
  if (waiting.length === 0 && !conflict) return false;
  decider.withdrawGates(task.id, (gate) => gate.type === 'merge');
  const reason = conflict
    ? describeConflictHold(decider, conflict)
    : `waiting for ${quoteTitles(waiting)} to be ready to merge`;
  decider.stage(task.id, 'shipping', reason);
  return true;
}

export function holdInBundle(decider: Decider, task: Task, commit: string | null) {
  const hasBelow = listBundleBelow(decider.state, task).length > 0;
  const hasAbove = listBundleAbove(decider.state, task).length > 0;
  if (!hasBelow && !hasAbove) return false;
  markBundleReady(decider, task.id, commit);
  if (hasBelow) {
    decider.stage(task.id, 'shipping', READY_REASON);
    nudgeBundleRoot(decider, decider.task(task.id));
    return true;
  }
  return holdBundleRoot(decider, decider.task(task.id));
}

export function keepsBundleReady(task: Task, commit: string | null, clean: boolean) {
  if (!task.bundleReady) return false;
  return clean && task.bundleReady.commit === commit;
}

export function describeBundleMerge(state: Decider['state'], task: Task) {
  const above = listBundleAbove(state, task);
  if (above.length === 0) return null;
  const pullRequests = [task, ...above]
    .map((member) => (member.pullRequest ? `#${member.pullRequest.number} “${member.title}”` : null))
    .filter(Boolean)
    .join(', ');
  return `Approving merges the whole bundle as one, from the last pull request back to this one: ${pullRequests}.`;
}

export function startBundleMerge(decider: Decider, taskId: string): BundlePullRequest[] {
  const bundle: BundlePullRequest[] = [];
  for (const above of listBundleAbove(decider.state, decider.task(taskId)).reverse()) {
    if (!above.pullRequest) continue;
    decider.stage(above.id, 'awaiting_merge', MERGING_REASON);
    bundle.push({ taskId: above.id, number: above.pullRequest.number });
  }
  return bundle;
}

function isAtRest(decider: Decider, task: Task) {
  return (
    task.stage === 'shipping' &&
    !task.pushPending &&
    listActiveRuns(decider.state, task.id).length === 0 &&
    listOpenGates(decider.state, task.id).length === 0
  );
}

export function startBundleUpdate(decider: Decider, conflict: BundleConflict) {
  const behind = conflict.behindTaskId ? decider.state.tasks[conflict.behindTaskId] : null;
  if (!behind || !isAtRest(decider, behind)) return null;
  clearBundleReady(decider, behind.id);
  decider.stage(behind.id, 'shipping', `updating the branch onto ${conflict.base}`);
  return behind.id;
}

function recheck(decider: Decider, taskId: string) {
  decider.stage(taskId, 'shipping', 'checking the pull request');
  decider.run({ kind: 'pull_request.watch', taskId });
}

function reviewReadiness(decider: Decider, task: Task) {
  const hasBelow = listBundleBelow(decider.state, task).length > 0;
  const hasAbove = listBundleAbove(decider.state, task).length > 0;
  const gate = selectMergeGate(decider, task.id);
  if (task.bundleConflict && (!hasAbove || hasBelow || !SHIPPED.has(task.stage))) {
    decider.emit({ type: 'task.bundle_conflict', taskId: task.id, conflict: null });
  }
  if (gate && hasAbove) {
    holdInBundle(decider, task, gate.commit ?? null);
    return;
  }
  if (task.bundleReady && !SHIPPED.has(task.stage)) {
    clearBundleReady(decider, task.id);
    return;
  }
  if (!hasBelow && !hasAbove && task.bundleReady && task.stage === 'shipping') {
    clearBundleReady(decider, task.id);
    recheck(decider, task.id);
    return;
  }
  const root = resolveBundleRoot(decider.state, task);
  if (hasBelow && isBundleMerging(decider, task) && !isBundleMerging(decider, root)) {
    decider.stage(task.id, 'shipping', READY_REASON);
  }
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
  return Boolean(
    task.stacksOn || task.stackBase || task.bundleReady || task.bundleConflict || parents.has(task.id)
  );
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
