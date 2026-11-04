import { type FeedbackDraftInput, PRIVATE_WORDS_LIMIT, SOURCE_LINES } from './schema.ts';

export function describeFeedbackPrompt(input: FeedbackDraftInput) {
  const words = input.privateWords.slice(0, PRIVATE_WORDS_LIMIT);
  return [
    SOURCE_LINES[input.source],
    `Private words: ${words.length > 0 ? words.join(', ') : 'none'}`,
    'Context:',
    ...input.context.map((line) => `- ${line}`),
    'Feedback:',
    input.note,
  ].join('\n');
}
