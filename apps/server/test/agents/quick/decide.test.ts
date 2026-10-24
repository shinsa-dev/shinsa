import { describe, expect, test } from 'bun:test';
import {
  type ChoiceQuestion,
  type ChoicesQuestion,
  describeDecisionQuestion,
  parseDecisionAnswer,
  resolveDecisionProperty,
} from '../../../src/agents/quick/decide.ts';

const TEAM: ChoiceQuestion = {
  type: 'choice',
  instructions: 'Which team should handle it?',
  criteria: { billing: 'Charges and payments', technical: 'Product failures' },
};

const LABELS: ChoicesQuestion = {
  type: 'choices',
  instructions: 'Which labels fit?',
  criteria: { bug: 'Something is broken', urgent: 'It cannot wait' },
};

describe('a choice decision', () => {
  test('its schema is a string that accepts only the options', () => {
    expect(resolveDecisionProperty(TEAM)).toEqual({ type: 'string', enum: ['billing', 'technical'] });
  });

  test('it is described with every option and what each means', () => {
    expect(describeDecisionQuestion('team', TEAM)).toBe(
      '- team (choice): Which team should handle it? Options: "billing": Charges and payments; "technical": Product failures. Answer with exactly one option, copied exactly.'
    );
  });

  test('an answer is one of the options, copied exactly, and anything else is refused', () => {
    expect(parseDecisionAnswer(TEAM, 'billing')).toBe('billing');
    for (const broken of ['sales', 'constructor', 'Billing', 3, null, { choice: 'billing' }, ['billing']]) {
      expect(parseDecisionAnswer(TEAM, broken)).toBeNull();
    }
  });
});

describe('a choices decision', () => {
  test('its schema is a list of distinct options, and an empty list when there are none', () => {
    expect(resolveDecisionProperty(LABELS)).toEqual({
      type: 'array',
      items: { type: 'string', enum: ['bug', 'urgent'] },
      uniqueItems: true,
    });
    expect(resolveDecisionProperty({ ...LABELS, criteria: {} })).toEqual({ type: 'array', maxItems: 0 });
  });

  test('it is described with every option, or says there are none', () => {
    expect(describeDecisionQuestion('labels', LABELS)).toBe(
      '- labels (choices): Which labels fit? Options: "bug": Something is broken; "urgent": It cannot wait. Answer with a list of options, copied exactly, or an empty list.'
    );
    expect(describeDecisionQuestion('labels', { ...LABELS, criteria: {} })).toBe(
      '- labels (choices): Which labels fit? There are no options. Answer with a list of options, copied exactly, or an empty list.'
    );
  });

  test('an answer is any subset of the options, once each, and one stray value refuses it all', () => {
    expect(parseDecisionAnswer(LABELS, [])).toEqual([]);
    expect(parseDecisionAnswer(LABELS, ['urgent', 'bug', 'urgent'])).toEqual(['urgent', 'bug']);
    for (const broken of [['bug', 'feature'], ['bug', 7], 'bug', null, { bug: true }]) {
      expect(parseDecisionAnswer(LABELS, broken)).toBeNull();
    }
  });
});
