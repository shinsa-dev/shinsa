import { Option } from 'effect';
import {
  DomainError,
  type ReplyingHandOver,
  resolveCurrentRound,
  selectOpenIteration,
  type SuggestedAction,
  type Task,
} from '../domain/index.ts';
import type { AgentReply } from '../report/types.ts';
import type { Decider } from './decider.ts';

export function requestIteration(decider: Decider, taskId: string, text: string | null, comments: number) {
  const task = decider.task(taskId);
  decider.emit({
    type: 'iteration.requested',
    taskId,
    iterationId: Option.getOrNull(selectOpenIteration(task))?.id ?? decider.context.newId(),
    round: resolveCurrentRound(task).number,
    text: text?.trim() ?? '',
    comments,
  });
}

export function answerIteration(
  decider: Decider,
  task: Task,
  runId: string,
  reply: AgentReply | null,
  tool: ReplyingHandOver
) {
  const open = Option.getOrNull(selectOpenIteration(task));
  if (!open && reply) {
    throw new DomainError({
      code: 'reply_unasked',
      message: `Leave \`reply\` out: it answers a message the human sent, and this \`${tool}\` answers none.`,
    });
  }
  if (!open) return;
  if (!reply) {
    throw new DomainError({
      code: 'reply_required',
      message: `This \`${tool}\` answers a message the human sent, so \`reply\` is required: a headline, each point they raised with its outcome and a note, and what they do now. Call \`${tool}\` again with it.`,
    });
  }
  decider.emit({ type: 'iteration.answered', taskId: task.id, iterationId: open.id, reply, runId });
}

export function suggestActions(decider: Decider, task: Task, runId: string, actions: SuggestedAction[] = []) {
  if (actions.length === 0 && (task.suggestedActions ?? []).length === 0) return;
  decider.emit({ type: 'task.actions_suggested', taskId: task.id, actions, runId });
}
