import type { CommandOf } from '../commands/index.ts';
import { isTaskSettled, type PullRequest, type Task, type TaskStage } from '../domain/index.ts';
import {
  resolveConflictFixPrompt,
  resolveConflictSteer,
  resolveWorkspaceUpdatedFixPrompt,
} from '../prompts/index.ts';
import { listActiveRuns, listRunningRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { startFix } from './fixes.ts';

const RESOLVABLE_STAGES = new Set<TaskStage>(['awaiting_review', 'shipping', 'awaiting_merge']);

export const UPDATING_WORKSPACE = 'updating the workspace';

function selectWritingRun(decider: Decider, taskId: string) {
  return listRunningRuns(decider.state, taskId).find(
    (run) => run.status !== 'waiting' && run.role === 'agent' && run.purpose !== 'plan'
  );
}

function isMerging(decider: Decider, task: Task) {
  return task.stage === 'awaiting_merge' && !decider.hasOpenGate(task.id, (gate) => gate.type === 'merge');
}

function isResolvableNow(decider: Decider, task: Task) {
  return (
    RESOLVABLE_STAGES.has(task.stage) &&
    !isMerging(decider, task) &&
    listActiveRuns(decider.state, task.id).length === 0
  );
}

function holdConflict(decider: Decider, taskId: string, branch: string | null) {
  if ((decider.task(taskId).heldConflict ?? null) === branch) return;
  decider.emit({ type: 'task.conflict_held', taskId, branch });
}

function startConflictFix(decider: Decider, taskId: string, branch: string) {
  startFix(decider, taskId, 'conflict', resolveConflictFixPrompt(branch), `conflict:${branch}`);
}

export function recordConflict(decider: Decider, command: CommandOf<'task.record_conflict'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || task.branch !== command.branch) return;
  const writing = selectWritingRun(decider, task.id);
  if (writing) {
    decider.run({
      kind: 'run.steer',
      runId: writing.id,
      text: resolveConflictSteer(command.branch),
      from: 'shinsa',
    });
    holdConflict(decider, task.id, null);
    return;
  }
  if (!isResolvableNow(decider, task)) {
    holdConflict(decider, task.id, command.branch);
    return;
  }
  decider.withdrawGates(task.id, (gate) => gate.type === 'review' || gate.type === 'merge');
  startConflictFix(decider, task.id, command.branch);
}

export function startHeldConflictFix(decider: Decider, taskId: string) {
  const task = decider.task(taskId);
  if (!task.heldConflict || task.heldConflict !== task.branch) return false;
  startConflictFix(decider, taskId, task.heldConflict);
  return true;
}

export function isAwaitingWorkspaceUpdate(decider: Decider, task: Task) {
  return (
    task.stageReason === UPDATING_WORKSPACE ||
    decider.hasOpenGate(task.id, (gate) => gate.cause === 'workspace_update')
  );
}

export function askToUpdateWorkspace(decider: Decider, task: Task, pullRequest: PullRequest) {
  const base = pullRequest.base ?? 'its base';
  decider.stage(task.id, 'shipping', 'waiting for you to update the workspace');
  decider.fail(
    task.id,
    `Pull request #${pullRequest.number} conflicts with ${base}`,
    `Its branch is in your GitButler workspace, where only \`but pull\` brings in ${base}. It rebases every applied branch, yours too, and keeps your uncommitted work. Update the workspace to run it; the agent then resolves what is left on this branch in its own session, and Shinsa pushes the result.`,
    null,
    'workspace_update'
  );
}

export function updateWorkspace(decider: Decider, taskId: string, guidance: string | null) {
  decider.stage(taskId, 'shipping', UPDATING_WORKSPACE);
  decider.run({ kind: 'workspace.update', taskId, guidance });
}

export function recordWorkspaceUpdate(decider: Decider, command: CommandOf<'task.record_workspace_update'>) {
  const task = decider.task(command.taskId);
  if (isTaskSettled(task) || task.stageReason !== UPDATING_WORKSPACE || !task.branch) return;
  startFix(
    decider,
    task.id,
    'conflict',
    resolveWorkspaceUpdatedFixPrompt(task.branch, command.guidance),
    `update:${task.pullRequest?.headSha ?? task.branch}`
  );
}
