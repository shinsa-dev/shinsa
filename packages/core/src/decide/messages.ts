import type { CommandOf } from '../commands/index.ts';
import { DomainError, isTaskSettled } from '../model/index.ts';
import { resolveHumanFixPrompt } from '../prompts/index.ts';
import { listOpenGates, listRunningRuns } from '../state/queries.ts';
import type { Decider } from './decider.ts';
import { startFix } from './fixes.ts';
import { answerGate } from './gates.ts';
import { resolveCurrentPhase, startPhase, startPlanning } from './lifecycle.ts';

function deliverMessage(decider: Decider, taskId: string, text: string) {
  const gates = listOpenGates(decider.state, taskId);
  const failure = gates.find((gate) => gate.purpose === 'failure');
  if (failure) {
    answerGate(decider, failure.id, 'approve', text);
    return;
  }
  const question = gates.find((gate) => gate.purpose === 'agent_question');
  if (question) {
    answerGate(decider, question.id, 'answer', text);
    return;
  }
  const task = decider.task(taskId);
  switch (task.stage) {
    case 'triage':
    case 'queued':
      return;
    case 'awaiting_spec':
    case 'planning':
      decider.withdrawGates(taskId, (gate) => gate.kind === 'spec');
      startPlanning(decider, taskId, text);
      return;
    case 'building':
      startPhase(
        decider,
        taskId,
        resolveCurrentPhase(task),
        decider.lastRun(taskId, ['builder']),
        `\n\nThe human added: ${text}`
      );
      return;
    default:
      decider.withdrawGates(taskId, (gate) => gate.kind === 'review' || gate.kind === 'merge');
      startFix(decider, taskId, 'you', resolveHumanFixPrompt(text), null);
  }
}

export function messageTask(decider: Decider, command: CommandOf<'task.message'>) {
  const task = decider.task(command.taskId);
  const text = command.text.trim();
  if (text.length === 0) throw new DomainError('message_required', 'Write a message first.');
  if (isTaskSettled(task)) throw new DomainError('task_settled', 'This task is finished. Start a new one.');
  decider.emit({ type: 'task.messaged', taskId: task.id, text });
  const [running] = listRunningRuns(decider.state, task.id);
  if (running && listOpenGates(decider.state, task.id).length === 0) {
    decider.run({ kind: 'run.steer', runId: running.id, text });
    return;
  }
  deliverMessage(decider, task.id, text);
}

export function redeliverMessage(decider: Decider, command: CommandOf<'message.deliver'>) {
  const task = decider.state.tasks[command.taskId];
  if (!task || isTaskSettled(task)) return;
  deliverMessage(decider, task.id, command.text);
}
