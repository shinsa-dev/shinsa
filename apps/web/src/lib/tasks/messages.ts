import { type MessageEffect, resolveMessageEffect, type ShinsaState, type Task } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';

export interface MessageHint {
  placeholder: string;
  sent: string;
}

const MESSAGE_HINTS: Record<Exclude<MessageEffect, 'closed'>, MessageHint> = {
  steer: {
    placeholder: 'Tell the agent something. It reaches the agent while it works.',
    sent: 'Sent to the agent.',
  },
  wake: {
    placeholder: 'Tell the agent something. It reads it when its delegated tasks report back.',
    sent: 'Sent. The agent reads it when it wakes.',
  },
  restart_step: {
    placeholder: 'Tell the agent something. The step starts again with your message.',
    sent: 'Sent. The step starts again with your message.',
  },
  kept: {
    placeholder: 'Tell the agent something. The first agent on this task reads it.',
    sent: 'Saved. The first agent on this task reads it.',
  },
  follow_up: {
    placeholder: 'Ask a follow-up. The agent answers on this task.',
    sent: 'Sent. The agent answers on this task.',
  },
  new_round: {
    placeholder: 'Ask for the next piece of work. It starts as a new round of this task.',
    sent: 'Sent. It starts as a new round of this task.',
  },
  retry: {
    placeholder: 'Say what to do differently. The step starts again with your message.',
    sent: 'Retrying with your message.',
  },
  supersede_question: {
    placeholder: 'Reply instead of answering. The question is withdrawn and the agent gets your message.',
    sent: 'Sent instead of an answer.',
  },
  revise_plan: {
    placeholder: 'Say what to change in the plan. The planner revises it and asks you again.',
    sent: 'Sent. The planner revises the plan.',
  },
  decline_change: {
    placeholder:
      'Reply instead of deciding. The proposal is declined and the agent carries on with your message.',
    sent: 'Sent. The agent carries on with your message.',
  },
  operation_notes: {
    placeholder: 'Add notes for the operator. They go with the operation once you run it.',
    sent: 'Saved as notes for the operator.',
  },
  request_changes: {
    placeholder: 'Ask for changes. A fixer makes them and the review comes back to you.',
    sent: 'Changes requested. A fixer is on it.',
  },
  send_back: {
    placeholder: 'Ask for a change before the merge. A fixer makes it and the merge comes back to you.',
    sent: 'Sent back. A fixer is on it.',
  },
  fix: {
    placeholder: 'Ask for a change. A fixer makes it.',
    sent: 'Sent. A fixer is on it.',
  },
};

export function resolveMessageHint(state: ShinsaState, task: Task): MessageHint | null {
  const effect = resolveMessageEffect(state, task);
  return effect === 'closed' ? null : MESSAGE_HINTS[effect];
}

export function sendTaskMessage(task: Task, hint: MessageHint, text: string) {
  return sendCommandWithToast({ type: 'task.message', taskId: task.id, text }, hint.sent);
}
