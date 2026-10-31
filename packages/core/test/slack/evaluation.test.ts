import { describe, expect, test } from 'bun:test';
import {
  parseSlackEvaluation,
  SLACK_EVALUATION_LIMITS,
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
  text: '',
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
        'Christo (mentioning you): ',
        '',
        'Answer with JSON: {"decision": "task" or "none", "text": the request when it is a task, else the reason}.',
      ].join('\n')
    );
  });
});

describe('the evaluation answer', () => {
  test('is a task with its request, or nothing with its reason, each trimmed to its limit', () => {
    expect(parseSlackEvaluation({ decision: 'task', text: ' Fix the export hang. ' })).toEqual({
      kind: 'task',
      request: 'Fix the export hang.',
    });
    expect(parseSlackEvaluation({ decision: 'none', text: 'x'.repeat(500) })).toEqual({
      kind: 'none',
      reason: 'x'.repeat(SLACK_EVALUATION_LIMITS.reason),
    });
  });

  test('is unreadable without a decision it knows or without text', () => {
    expect(parseSlackEvaluation(null)).toBeNull();
    expect(parseSlackEvaluation({ decision: 'task', text: '  ' })).toBeNull();
    expect(parseSlackEvaluation({ decision: 'maybe', text: 'Hm.' })).toBeNull();
    expect(parseSlackEvaluation({ decision: 'task' })).toBeNull();
  });
});
