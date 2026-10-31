import { describe, expect, test } from 'bun:test';
import {
  listSlackAnsweredBlocks,
  parseSlackAnswer,
  parseSlackAnswerReply,
  parseSlackAnswerValue,
  SLACK_QUESTION_BLOCK,
  serializeSlackAnswerValue,
} from '../../src/index.ts';

const ANSWER = {
  interactionId: 'I1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '100.1',
  messageTs: '100.9',
  userId: 'U1',
  gateId: 'q1',
  choice: 1,
};

describe('the value a choice button carries', () => {
  test('names the gate and the choice, and nothing else reads as one', () => {
    expect(parseSlackAnswerValue(serializeSlackAnswerValue('q1', 2))).toEqual({ gateId: 'q1', choice: 2 });
    expect(parseSlackAnswerValue('not json')).toBeNull();
    expect(parseSlackAnswerValue('[1]')).toBeNull();
    expect(parseSlackAnswerValue(JSON.stringify({ gateId: 'q 1', choice: 0 }))).toBeNull();
    expect(parseSlackAnswerValue(JSON.stringify({ gateId: 'q1', choice: -1 }))).toBeNull();
    expect(parseSlackAnswerValue(JSON.stringify({ gateId: 'q1', choice: 1.5 }))).toBeNull();
    expect(parseSlackAnswerValue(JSON.stringify({ gateId: 'q1', choice: 100 }))).toBeNull();
  });
});

describe('an answer app.shinsa.dev forwards', () => {
  test('keeps every part, and drops one that is missing or malformed', () => {
    expect(parseSlackAnswer(ANSWER)).toEqual(ANSWER);
    expect(parseSlackAnswer(null)).toBeNull();
    expect(parseSlackAnswer({ ...ANSWER, userId: '' })).toBeNull();
    expect(parseSlackAnswer({ ...ANSWER, gateId: 'x'.repeat(65) })).toBeNull();
    expect(parseSlackAnswer({ ...ANSWER, choice: '1' })).toBeNull();
  });

  test('is answered with the choice or the reason it was refused', () => {
    expect(parseSlackAnswerReply({ answered: true, choice: 'JSON' })).toEqual({
      answered: true,
      choice: 'JSON',
    });
    expect(parseSlackAnswerReply({ answered: false, reason: 'x'.repeat(600) })).toEqual({
      answered: false,
      reason: 'x'.repeat(500),
    });
    expect(parseSlackAnswerReply({ answered: true })).toBeNull();
    expect(parseSlackAnswerReply('yes')).toBeNull();
  });
});

describe('the question once answered', () => {
  test('swaps its buttons for who answered, and keeps every other block', () => {
    const header = { type: 'header', text: { type: 'plain_text', text: 'Question for you' } };
    const buttons = { type: 'actions', block_id: `${SLACK_QUESTION_BLOCK}.q1`, elements: [] };
    const other = { type: 'actions', block_id: 'other', elements: [] };
    const answered = { type: 'context', elements: [] };
    expect(listSlackAnsweredBlocks([header, buttons, other, 'odd'], answered)).toEqual([
      header,
      answered,
      other,
      'odd',
    ]);
  });
});
