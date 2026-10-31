import { describe, expect, test } from 'bun:test';
import {
  parseSlackEvaluation,
  SLACK_EVALUATION_SYSTEM,
  SLACK_REPLY_LIMIT,
  type SlackMention,
  serializeSlackEvaluationPrompt,
} from '../../src/index.ts';

const MENTION: SlackMention = {
  eventId: 'Ev1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '100.1',
  messageTs: '100.3',
  userId: 'U1',
  userName: 'Christo',
  text: 'hi',
  permalink: null,
  thread: [{ ts: '100.1', userId: 'U2', userName: 'Mia', text: 'Export hangs.', bot: false }],
};

describe('the evaluation prompt', () => {
  test('keeps its fixed system prompt free of the thread and puts the thread in the prompt', () => {
    expect(SLACK_EVALUATION_SYSTEM).not.toContain('Mia');
    expect(serializeSlackEvaluationPrompt(MENTION)).toBe(
      [
        'The thread, oldest first:',
        'Mia: Export hangs.',
        'Christo (mentioning you): hi',
        '',
        'Answer with JSON: {"decision": "task" or "reply", "reply": the reply when you only reply, else ""}.',
      ].join('\n')
    );
  });
});

describe('the evaluation answer', () => {
  test('is a task, or a reply trimmed to its limit', () => {
    expect(parseSlackEvaluation({ decision: 'task', reply: '' })).toEqual({ kind: 'task' });
    expect(parseSlackEvaluation({ decision: 'reply', reply: ' Hi Christo! ' })).toEqual({
      kind: 'reply',
      text: 'Hi Christo!',
    });
    expect(parseSlackEvaluation({ decision: 'reply', reply: 'x'.repeat(900) })).toEqual({
      kind: 'reply',
      text: 'x'.repeat(SLACK_REPLY_LIMIT),
    });
  });

  test('is unreadable without a decision it knows, or a reply without words', () => {
    expect(parseSlackEvaluation(null)).toBeNull();
    expect(parseSlackEvaluation({ decision: 'reply', reply: '  ' })).toBeNull();
    expect(parseSlackEvaluation({ decision: 'reply' })).toBeNull();
    expect(parseSlackEvaluation({ decision: 'maybe', reply: 'Hm.' })).toBeNull();
  });
});
