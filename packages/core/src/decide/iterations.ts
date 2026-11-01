import { DomainError, resolveCurrentRound, selectOpenIteration, type Task } from '../domain/index.ts';
import type { AgentReply } from '../report/types.ts';
import type { Decider } from './decider.ts';

export type ReplyingHandOver =
  | 'propose_plan'
  | 'complete_phase'
  | 'complete_fix'
  | 'answer'
  | 'report_diagnosis'
  | 'submit_report'
  | 'report_outcome';

export function requestIteration(decider: Decider, taskId: string, text: string | null, comments: number) {
  const task = decider.task(taskId);
  decider.emit({
    type: 'iteration.requested',
    taskId,
    iterationId: selectOpenIteration(task)?.id ?? decider.context.newId(),
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
  const open = selectOpenIteration(task);
  if (!open && reply) {
    throw new DomainError(
      'reply_unasked',
      `Leave \`reply\` out: it answers a message the human sent, and this \`${tool}\` answers none.`
    );
  }
  if (!open) return;
  if (!reply) {
    throw new DomainError(
      'reply_required',
      `This \`${tool}\` answers a message the human sent, so \`reply\` is required: a headline, each point they raised with its outcome and a note, and what they do now. Call \`${tool}\` again with it.`
    );
  }
  decider.emit({ type: 'iteration.answered', taskId: task.id, iterationId: open.id, reply, runId });
}
