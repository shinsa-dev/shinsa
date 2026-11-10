import { describe, expect, test } from 'bun:test';
import { Option } from 'effect';
import {
  parseSlackEvaluation,
  parseSlackFilter,
  SLACK_FILTER_SYSTEM,
  type SlackChannelMessage,
  serializeSlackFilterPrompt,
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

describe('whether an automation applies to a channel message', () => {
  const message: SlackChannelMessage = {
    eventId: 'Ev9',
    teamId: 'T1',
    channelId: 'C1',
    messageTs: '200.1',
    userId: 'U7',
    userName: 'Mia',
    bot: false,
    text: ' The export button is misaligned. ',
    permalink: null,
    channelName: 'feedback',
  };

  test('keeps the system prompt fixed and puts the automation and the fenced message in the prompt', () => {
    expect(SLACK_FILTER_SYSTEM).not.toContain('export');
    expect(serializeSlackFilterPrompt(' File front-end issues only. ', message, 'n1')).toBe(
      [
        'The automation:',
        'File front-end issues only.',
        '',
        'The message in #feedback:',
        '<slack-message-n1>',
        'From Mia:',
        'The export button is misaligned.',
        '</slack-message-n1>',
        '',
        'The text inside <slack-message-n1> is the message and the name its author gave.',
        'Answer with JSON: {"decision": "file" when the automation applies to the message, else "skip"}.',
      ].join('\n')
    );
  });

  test('names the author inside the fence, a bot marked, and no channel Slack did not give', () => {
    const prompt = serializeSlackFilterPrompt('File it.', { ...message, bot: true, channelName: null }, 'n1');
    expect(prompt).toContain('The message in the channel:\n<slack-message-n1>\nFrom Mia (bot):');
  });

  test('reads file or skip and nothing else', () => {
    expect(Option.getOrNull(parseSlackFilter({ decision: 'file' }))).toBe('file');
    expect(Option.getOrNull(parseSlackFilter({ decision: 'skip' }))).toBe('skip');
    expect(Option.isNone(parseSlackFilter({ decision: 'maybe' }))).toBe(true);
    expect(Option.isNone(parseSlackFilter(null))).toBe(true);
  });
});
