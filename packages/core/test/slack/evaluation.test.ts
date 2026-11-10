import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
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
  channelName: null,
  thread: [{ ts: '100.1', userId: 'U2', userName: 'Mia', text: 'Export hangs.', bot: false }],
  linkedThreads: [],
  linkedUserId: null,
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

describe('the evaluation of a mention that links to a thread', () => {
  test('reads the linked thread after the mention’s own', () => {
    const linked = {
      channelId: 'C9',
      threadTs: '200.1',
      permalink: 'https://acme.slack.com/archives/C9/p2001',
      channelName: 'customer-acme',
      thread: [{ ts: '200.1', userId: 'U7', userName: 'Lee', text: 'Login fails.', bot: false }],
    };
    expect(
      serializeSlackEvaluationPrompt({ ...MENTION, linkedThreads: [linked, { ...linked, thread: [] }] })
    ).toBe(
      [
        'The thread, oldest first:',
        'Mia: Export hangs.',
        'Christo (mentioning you): hi',
        '',
        'Linked thread 1 in #customer-acme: https://acme.slack.com/archives/C9/p2001, oldest first:',
        'Lee: Login fails.',
        '',
        'Answer with JSON: {"decision": "task" when it asks for work, else "none"}.',
      ].join('\n')
    );
    expect(SLACK_EVALUATION_SYSTEM).toContain('any thread it links to');
  });
});

describe('the evaluation answer', () => {
  test('is a task or not a task, and nothing else', () => {
    expect(Option.getOrNull(parseSlackEvaluation({ decision: 'task' }))).toBe('task');
    expect(Option.getOrNull(parseSlackEvaluation({ decision: 'none' }))).toBe('none');
    expect(SLACK_EVALUATION_SYSTEM).toContain('never chats');
  });

  test('is unreadable without a decision it knows', () => {
    expect(Option.getOrNull(parseSlackEvaluation(null))).toBeNull();
    expect(Option.getOrNull(parseSlackEvaluation({}))).toBeNull();
    expect(Option.getOrNull(parseSlackEvaluation({ decision: 'reply' }))).toBeNull();
  });
});
