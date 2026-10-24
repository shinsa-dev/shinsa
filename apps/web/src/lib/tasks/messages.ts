import { type MessageEffect, resolveMessageEffect, type ShinsaState, type Task } from '@shinsa/core';
import { sendCommandWithToast } from '@/lib/connection/commands.ts';
import { sendThroughOutbox } from '@/lib/tasks/outbox.ts';

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
    placeholder: 'Tell the agent something. It reads it when its delegations report back.',
    sent: 'Sent to the agent.',
  },
  restart_step: {
    placeholder: 'Tell the agent something. The step starts again with your message.',
    sent: 'Sent. Restarting the step.',
  },
  kept: {
    placeholder: 'Tell the agent something. The first agent on this task reads it.',
    sent: 'Saved for the first agent.',
  },
  follow_up: {
    placeholder: 'Ask a follow-up, or for more work.',
    sent: 'Sent.',
  },
  retry: {
    placeholder: 'Say what to do differently. The step starts again with your message.',
    sent: 'Retrying with your message.',
  },
  verify_setup: {
    placeholder: 'Tell the agent something. The setup is verified again and the first agent reads it.',
    sent: 'Verifying the setup again.',
  },
  supersede_question: {
    placeholder: 'Reply instead of answering. The question is withdrawn and the agent gets your message.',
    sent: 'Sent instead of an answer.',
  },
  revise_plan: {
    placeholder: 'Say what to change in the plan. The planner revises it and asks you again.',
    sent: 'Sent to the planner.',
  },
  decline_proposal: {
    placeholder:
      'Reply instead of deciding. The proposal is declined and the agent carries on with your message.',
    sent: 'Proposal declined.',
  },
  operation_notes: {
    placeholder: 'Write the notes for the operator. They replace the saved notes and go with the operation.',
    sent: 'Notes saved.',
  },
  request_changes: {
    placeholder: 'Ask for changes. A fixer makes them and the review comes back to you.',
    sent: 'Changes requested.',
  },
  send_back: {
    placeholder: 'Ask for a change before the merge. A fixer makes it and the merge comes back to you.',
    sent: 'Sent back for a fix.',
  },
  fix: {
    placeholder: 'Ask for a change. A fixer makes it.',
    sent: 'Sent to a fixer.',
  },
};

export function resolveMessageHint(state: ShinsaState, task: Task): MessageHint | null {
  const effect = resolveMessageEffect(state, task);
  return effect === 'closed' ? null : MESSAGE_HINTS[effect];
}

export function sendTaskMessage(task: Task, hint: MessageHint, text: string) {
  return sendThroughOutbox(task.id, text, () =>
    sendCommandWithToast({ type: 'task.message', taskId: task.id, text }, hint.sent)
  );
}
