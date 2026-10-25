import type { CommandOf } from '../commands/index.ts';
import {
  DomainError,
  describeHumanEdits,
  type EditsApproval,
  isDelegatedRun,
  resolveEditRefusal,
  type Task,
} from '../domain/index.ts';
import { listRunningRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';

export function recordEdit(decider: Decider, command: CommandOf<'task.record_edit'>) {
  const task = decider.task(command.taskId);
  const refusal = resolveEditRefusal(task);
  if (refusal) throw new DomainError('edit_refused', refusal);
  const edited = (task.editedPaths ?? []).includes(command.path);
  const untold = (task.untoldEdits ?? []).includes(command.path);
  if (command.changed ? edited && untold : !edited) return;
  decider.emit({ type: 'task.edited', taskId: task.id, path: command.path, changed: command.changed });
  if (!command.changed || untold) return;
  const running = listRunningRuns(decider.state, task.id).find(
    (run) => run.status !== 'waiting' && !isDelegatedRun(run)
  );
  if (running)
    decider.run({ kind: 'run.steer', runId: running.id, text: describeHumanEdits([command.path]) });
}

export function commitEdits(decider: Decider, command: CommandOf<'task.commit_edits'>) {
  const task = decider.task(command.taskId);
  if ((task.editedPaths ?? []).length === 0) return;
  decider.emit({ type: 'task.edits_committed', taskId: task.id });
  if (command.treeHash && task.treeHash !== command.treeHash) {
    decider.emit({ type: 'work.committed', taskId: task.id, treeHash: command.treeHash });
  }
}

export function hasUncommittedEdits(task: Pick<Task, 'editedPaths'>) {
  return (task.editedPaths ?? []).length > 0;
}

export function recordEditsApproval(decider: Decider, taskId: string, gate: EditsApproval) {
  decider.emit({ type: 'task.edits_approved', taskId, gate });
}

export function applyEditsApproval(decider: Decider, taskId: string, gate: EditsApproval) {
  if (decider.task(taskId).approvedEdits !== gate) return false;
  decider.emit({ type: 'task.edits_approved', taskId, gate: null });
  return true;
}
