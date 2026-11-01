import { type ReplyingHandOver, selectOpenIteration, type Task } from '../domain/index.ts';

export function describeReplyInstruction(tool: ReplyingHandOver) {
  return [
    '',
    `This answers a message the human sent, so \`${tool}\` also takes \`reply\`, which they read first, above the rest of your hand-over:`,
    '- `headline`: one sentence, what you did about their message.',
    '- `points`: each thing they raised, in their words cut short, with its outcome (`done`, `answered` for a question, `not_changed` when you left it as it was) and a note: where it is now, the answer, or why you left it.',
    '- `next`: what they do now to see or try it, in markdown, with the exact commands and links. Leave it out when there is nothing.',
  ].join('\n');
}

export function describeOwedReply(task: Pick<Task, 'iterations'>, tool: ReplyingHandOver) {
  return selectOpenIteration(task) ? describeReplyInstruction(tool) : '';
}
