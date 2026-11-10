import { Option } from 'effect';
import {
  type BundleConflict,
  type BundlePullRequest,
  isTaskSettled,
  type Task,
  type TaskStage,
} from '../domain/index.ts';
import {
  listActiveRuns,
  listBundleFollowers,
  listOpenGates,
  listStackParents,
  resolveBundleLead,
  resolveBundleMembers,
} from '../state/queries.ts';
import { type Decider, quoteTitles } from './decider.ts';
import { syncStackBases } from './dependencies.ts';

const READY_REASON = 'ready, merges with its bundle';

const MERGING_REASON = 'merging with its bundle';

const NOT_STARTED: ReadonlySet<TaskStage> = new Set<TaskStage>(['triage', 'waiting_on_tasks']);

const SHIPPED: ReadonlySet<TaskStage> = new Set<TaskStage>(['shipping', 'awaiting_merge']);

function selectMergeGate(decider: Decider, taskId: string) {
  return listOpenGates(decider.state, taskId).find((gate) => gate.type === 'merge') ?? null;
}

function resolveBundlePlace(decider: Decider, task: Task) {
  const [lead, ...followers] = resolveBundleMembers(decider.state, task);
  const leads = lead?.id === task.id;
  return { follows: !leads, leads: leads && followers.length > 0, lead: lead ?? task };
}

function isBundleMerging(decider: Decider, task: Task) {
  return task.stage === 'awaiting_merge' && listOpenGates(decider.state, task.id).length === 0;
}

export function clearBundleReady(decider: Decider, taskId: string) {
  if (!decider.task(taskId).bundleReady) return;
  decider.emit({ type: 'task.bundle_ready', taskId, ready: null });
}

function nudgeBundleLead(decider: Decider, task: Task) {
  const lead = resolveBundleLead(decider.state, task);
  if (lead.id === task.id || lead.stage !== 'shipping' || lead.pushPending) return;
  if (lead.pullRequest?.state !== 'open' || listActiveRuns(decider.state, lead.id).length > 0) return;
  if (!listBundleFollowers(decider.state, lead).every((follower) => follower.bundleReady)) return;
  decider.run({ kind: 'pull_request.watch', taskId: lead.id });
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

function holdBundleLead(decider: Decider, task: Task) {
  const waiting = listBundleFollowers(decider.state, task).filter((follower) => !follower.bundleReady);
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
  const { follows, leads } = resolveBundlePlace(decider, task);
  if (!follows && !leads) return false;
  markBundleReady(decider, task.id, commit);
  if (follows) {
    decider.withdrawGates(task.id, (gate) => gate.type === 'merge');
    decider.stage(task.id, 'shipping', READY_REASON);
    nudgeBundleLead(decider, decider.task(task.id));
    return true;
  }
  return holdBundleLead(decider, decider.task(task.id));
}

export function keepsBundleReady(task: Task, commit: string | null, clean: boolean) {
  if (!task.bundleReady) return false;
  return clean && task.bundleReady.commit === commit;
}

export function describeBundleMerge(state: Decider['state'], task: Task): Option.Option<string> {
  const followers = listBundleFollowers(state, task);
  if (followers.length === 0) return Option.none();
  const pullRequests = [task, ...followers]
    .map((member) => (member.pullRequest ? `#${member.pullRequest.number} “${member.title}”` : null))
    .filter(Boolean)
    .join(', ');
  return Option.some(
    `Approving merges the whole bundle as one, each pull request into its base from the top of the bundle down and this one last: ${pullRequests}.`
  );
}

export function startBundleMerge(decider: Decider, taskId: string): BundlePullRequest[] {
  const bundle: BundlePullRequest[] = [];
  for (const follower of listBundleFollowers(decider.state, decider.task(taskId)).reverse()) {
    if (!follower.pullRequest) continue;
    decider.stage(follower.id, 'awaiting_merge', MERGING_REASON);
    bundle.push({ taskId: follower.id, number: follower.pullRequest.number });
  }
  return bundle;
}

function isShippingAtRest(decider: Decider, task: Task) {
  return (
    task.stage === 'shipping' &&
    !task.pushPending &&
    listActiveRuns(decider.state, task.id).length === 0 &&
    listOpenGates(decider.state, task.id).length === 0
  );
}

export function startBundleUpdate(decider: Decider, conflict: BundleConflict): Option.Option<string> {
  const behind = conflict.behindTaskId ? decider.state.tasks[conflict.behindTaskId] : null;
  if (!behind || !isShippingAtRest(decider, behind)) return Option.none();
  clearBundleReady(decider, behind.id);
  decider.stage(behind.id, 'shipping', `updating the branch onto ${conflict.base}`);
  return Option.some(behind.id);
}

function recheck(decider: Decider, taskId: string) {
  decider.stage(taskId, 'shipping', 'checking the pull request');
  decider.run({ kind: 'pull_request.watch', taskId });
}

function reviewReadiness(decider: Decider, task: Task) {
  const { follows, leads, lead } = resolveBundlePlace(decider, task);
  const gate = selectMergeGate(decider, task.id);
  if (task.bundleConflict && (!leads || !SHIPPED.has(task.stage))) {
    decider.emit({ type: 'task.bundle_conflict', taskId: task.id, conflict: null });
  }
  if (gate && (leads || follows)) {
    holdInBundle(decider, task, gate.commit ?? null);
    return;
  }
  if (task.bundleReady && !SHIPPED.has(task.stage)) {
    clearBundleReady(decider, task.id);
    return;
  }
  if (!follows && !leads && task.bundleReady && task.stage === 'shipping') {
    clearBundleReady(decider, task.id);
    recheck(decider, task.id);
    return;
  }
  if (follows && isBundleMerging(decider, task) && !isBundleMerging(decider, lead)) {
    decider.stage(task.id, 'shipping', READY_REASON);
  }
}

function describeCancelledParent(rest: Task[]) {
  const choice =
    rest.length > 0
      ? `Retry to keep it stacked on ${quoteTitles(rest)} only`
      : 'Retry to take it out of the bundle and base its pull request on the default branch';
  return `This task was stacked on it as a bundle. ${choice}, or cancel this one.`;
}

function reviewStackParents(decider: Decider, task: Task) {
  if (NOT_STARTED.has(task.stage)) return;
  const parents = listStackParents(decider.state, task);
  const cancelled = parents.find((parent) => parent.stage === 'cancelled');
  if (cancelled) {
    if (listOpenGates(decider.state, task.id).length > 0) return;
    const rest = parents.filter((parent) => parent.stage !== 'cancelled');
    decider.fail(task.id, `“${cancelled.title}” was cancelled`, describeCancelledParent(rest));
    return;
  }
  const bases = task.stackBases ?? [];
  if (bases.length === 0) return;
  syncStackBases(decider, task.id);
  const moved = decider.task(task.id);
  if (moved.stackBases?.[0] !== bases[0] && SHIPPED.has(moved.stage) && moved.pullRequest) {
    decider.run({ kind: 'pull_request.watch', taskId: task.id });
  }
}

function isBundled(task: Task, parents: ReadonlySet<string>) {
  return Boolean(
    (task.stacksOn?.length ?? 0) > 0 ||
    (task.stackBases?.length ?? 0) > 0 ||
    task.bundleReady ||
    task.bundleConflict ||
    parents.has(task.id)
  );
}

export function reviewBundles(decider: Decider) {
  const tasks = Object.values(decider.state.tasks);
  const parents = new Set(tasks.flatMap((task) => task.stacksOn ?? []));
  for (const { id } of tasks) {
    const task = decider.task(id);
    if (isTaskSettled(task) || !isBundled(task, parents)) continue;
    reviewReadiness(decider, task);
    reviewStackParents(decider, decider.task(id));
  }
}
