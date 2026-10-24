import type { Gate } from '@shinsa/core';

export function listQuestionChoices(gate: Gate) {
  return (gate.choices ?? []).map((choice) => ({
    label: choice,
    detail: choice === gate.recommendation ? 'Recommended' : null,
  }));
}

export function describeAnswerPlaceholder(gate: Gate) {
  return (gate.choices ?? []).length > 0
    ? 'Or write your own answer.'
    : 'Your answer goes straight to the agent.';
}
