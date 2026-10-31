import { describe, expect, test } from 'bun:test';
import {
  parseSlackEvaluation,
  SLACK_EVALUATION_SYSTEM,
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
        'Answer with JSON: {"decision": "task" when it asks for work, else "none"}.',
      ].join('\n')
    );
  });
});

describe('the evaluation answer', () => {
  test('is a task or not a task, and nothing else', () => {
    expect(parseSlackEvaluation({ decision: 'task' })).toBe('task');
    expect(parseSlackEvaluation({ decision: 'none' })).toBe('none');
    expect(SLACK_EVALUATION_SYSTEM).toContain('never chats');
  });

  test('is unreadable without a decision it knows', () => {
    expect(parseSlackEvaluation(null)).toBeNull();
    expect(parseSlackEvaluation({})).toBeNull();
    expect(parseSlackEvaluation({ decision: 'reply' })).toBeNull();
  });
});
