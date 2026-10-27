export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
}

export interface ChoicesQuestion {
  type: 'choices';
  instructions: string;
  criteria: Record<string, string>;
}

export type DecisionQuestion = ChoiceQuestion | ChoicesQuestion;

export function resolveDecisionProperty(question: DecisionQuestion): Record<string, unknown> {
  const options = Object.keys(question.criteria);
  if (question.type === 'choice') return { type: 'string', enum: options };
  if (options.length === 0) return { type: 'array', maxItems: 0 };
  return { type: 'array', items: { type: 'string', enum: options }, uniqueItems: true };
}

export function describeDecisionQuestion(id: string, question: DecisionQuestion) {
  const options = Object.entries(question.criteria).map(([option, meaning]) => `"${option}": ${meaning}`);
  const listed = options.length > 0 ? `Options: ${options.join('; ')}.` : 'There are no options.';
  const answer =
    question.type === 'choice'
      ? 'Answer with exactly one option, copied exactly.'
      : 'Answer with a list of options, copied exactly, or an empty list.';
  return `- ${id} (${question.type}): ${question.instructions} ${listed} ${answer}`;
}

export function parseDecisionAnswer(question: ChoiceQuestion, value: unknown): string | null;
export function parseDecisionAnswer(question: ChoicesQuestion, value: unknown): string[] | null;
export function parseDecisionAnswer(question: DecisionQuestion, value: unknown) {
  const isOption = (entry: unknown): entry is string =>
    typeof entry === 'string' && Object.hasOwn(question.criteria, entry);
  if (question.type === 'choice') return isOption(value) ? value : null;
  if (!Array.isArray(value) || !value.every(isOption)) return null;
  return [...new Set(value)];
}
