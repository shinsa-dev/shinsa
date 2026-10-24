import { describe, expect, it } from 'bun:test';
import { describeAnswerPlaceholder, listQuestionChoices } from '@/lib/overview/question.ts';
import { createGate } from '../../support/state.ts';

describe('a question with choices', () => {
  it('marks the recommended choice and asks for a written answer as the other way', () => {
    const gate = createGate({
      id: 'g',
      taskId: 't',
      choices: ['Keep it', 'Drop it'],
      recommendation: 'Drop it',
    });
    expect(listQuestionChoices(gate)).toEqual([
      { label: 'Keep it', detail: null },
      { label: 'Drop it', detail: 'Recommended' },
    ]);
    expect(describeAnswerPlaceholder(gate)).toBe('Or write your own answer.');
  });

  it('asks for a written answer when there are no choices', () => {
    const gate = createGate({ id: 'g', taskId: 't' });
    expect(listQuestionChoices(gate)).toEqual([]);
    expect(describeAnswerPlaceholder(gate)).toBe('Your answer goes straight to the agent.');
  });
});
