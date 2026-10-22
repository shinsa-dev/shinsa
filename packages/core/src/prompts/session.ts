export function resolveContinuePrompt() {
  return 'Shinsa restarted while you were working. Continue exactly where you left off and finish your step.';
}

export function resolveAnswerPrompt(question: string, answer: string) {
  return [`You asked the human: ${question}`, '', `Their answer: ${answer}`, '', 'Carry on.'].join('\n');
}
