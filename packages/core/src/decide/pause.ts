import type { CommandOf } from '../commands/index.ts';
import { DomainError, isPausingGate, isRetryArmed, type Task, type TaskStage } from '../domain/index.ts';
import type { ShinsaEffectKind } from '../effects/index.ts';
import type { ShinsaState } from '../state/project.ts';
import { listOpenGates } from '../state/queries.ts';
import type { Decider } from './decider.ts';

const PAUSABLE_STAGES: ReadonlySet<TaskStage> = new Set<TaskStage>([
  'triage',
  'planning',
  'building',
  'checking',
  'reviewing',
  'fixing',
  'shipping',
  'answering',
  'investigating',
  'researching',
  'operating',
]);

const PAUSED_EFFECTS: ShinsaEffectKind[] = [
  'task.triage',
  'config.verify',
  'worktree.create',
  'checks.run',
  'pull_request.open',
  'pull_request.push',
];

export const PAUSED_TITLE = 'You paused the task';

const PAUSED_DETAIL =
  'Its agent was stopped where it was. Resume to pick the step up again, or send it a message.';

export function isTaskPausable(state: ShinsaState, task: Task) {
  if (isRetryArmed(task)) return true;
  return PAUSABLE_STAGES.has(task.stage) && !listOpenGates(state, task.id).some(isPausingGate);
}

export function pauseTask(decider: Decider, command: CommandOf<'task.pause'>) {
  const task = decider.task(command.taskId);
  if (!isTaskPausable(decider.state, task)) {
    throw new DomainError({ code: 'not_pausable', message: 'Nothing is working on this task to pause.' });
  }
  decider.cancelEffects(task.id, PAUSED_EFFECTS, 'You paused the task.');
  decider.hold(task.id, PAUSED_TITLE, PAUSED_DETAIL, null, 'paused');
}
