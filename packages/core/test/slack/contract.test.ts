import { describe, expect, test } from 'bun:test';
import {
  isSameSlackThread,
  parseSlackMention,
  resolveSlackMentionThread,
  resolveSlackThreadKey,
  SLACK_LIMITS,
} from '../../src/index.ts';

const WIRE = {
  eventId: 'Ev1',
  teamId: 'T1',
  channelId: 'C1',
  threadTs: '100.1',
  messageTs: '100.3',
  userId: 'U1',
  userName: 'Christo',
  text: 'take this',
  permalink: 'https://acme.slack.com/archives/C1/p1003',
  channelName: 'support',
  thread: [{ ts: '100.1', userId: 'U2', userName: 'Mia', text: 'It hangs.', bot: false }],
  linkedThreads: [
    {
      channelId: 'C9',
      threadTs: '1730120000.123456',
      permalink: 'https://acme.slack.com/archives/C9/p1730120000123456',
      channelName: 'customer-acme',
      thread: [{ ts: '1730120000.123456', userId: 'U7', userName: 'Lee', text: 'Login fails.', bot: false }],
    },
  ],
  linkedUserId: null,
};

describe('a forwarded mention', () => {
  test('reads every field it carries', () => {
    expect(parseSlackMention(WIRE)).toEqual(WIRE);
  });

  test('names the account its Slack user is linked to, or no one when an older Worker leaves it out', () => {
    expect(parseSlackMention({ ...WIRE, linkedUserId: '7' })).toMatchObject({ linkedUserId: '7' });
    expect(parseSlackMention({ ...WIRE, linkedUserId: undefined })?.linkedUserId).toBeNull();
  });

  test('is refused without its ids, with an id that is not Slack’s shape, or when it is not an object', () => {
    expect(parseSlackMention(null)).toBeNull();
    expect(parseSlackMention([])).toBeNull();
    expect(parseSlackMention({ ...WIRE, eventId: undefined })).toBeNull();
    expect(parseSlackMention({ ...WIRE, teamId: 'T1/../x' })).toBeNull();
    expect(parseSlackMention({ ...WIRE, channelId: '' })).toBeNull();
    expect(parseSlackMention({ ...WIRE, userId: 'U'.repeat(SLACK_LIMITS.id + 1) })).toBeNull();
    expect(parseSlackMention({ ...WIRE, text: 3 })).toBeNull();
    expect(parseSlackMention({ ...WIRE, userName: null })).toBeNull();
  });

  test('cuts long text, keeps only an https permalink and drops broken thread messages', () => {
    const parsed = parseSlackMention({
      ...WIRE,
      text: 'x'.repeat(SLACK_LIMITS.text + 10),
      permalink: 'javascript:alert(1)',
      thread: [
        WIRE.thread[0],
        { ts: '100.2', userId: 'B1', userName: 'Deploy bot', text: 'Failed.', bot: true },
        { ts: '100.2' },
        'nope',
      ],
    });
    expect(parsed?.text).toHaveLength(SLACK_LIMITS.text);
    expect(parsed?.permalink).toBeNull();
    expect(parsed?.thread.map((message) => message.userName)).toEqual(['Mia', 'Deploy bot']);
    expect(parseSlackMention({ ...WIRE, thread: 'nope', permalink: undefined })).toMatchObject({
      thread: [],
      permalink: null,
    });
    expect(parseSlackMention({ ...WIRE, linkedThreads: undefined })?.linkedThreads).toEqual([]);
    const [linked] = WIRE.linkedThreads;
    if (!linked) throw new Error('The wire mention has a linked thread.');
    const broken = [
      { ...linked, permalink: 'javascript:alert(1)' },
      { ...linked, channelId: 'C1/x' },
      { ...linked, channelName: '', thread: [...linked.thread, 'nope'] },
    ];
    expect(parseSlackMention({ ...WIRE, linkedThreads: broken })?.linkedThreads).toEqual([
      { ...linked, channelName: null },
    ]);
    const many = Array.from({ length: SLACK_LIMITS.linkedThreads + 2 }, () => linked);
    expect(parseSlackMention({ ...WIRE, linkedThreads: many })?.linkedThreads).toHaveLength(
      SLACK_LIMITS.linkedThreads
    );
    expect(parseSlackMention({ ...WIRE, channelName: undefined })?.channelName).toBeNull();
    expect(parseSlackMention({ ...WIRE, channelName: '' })?.channelName).toBeNull();
    expect(parseSlackMention({ ...WIRE, channelName: 'c'.repeat(200) })?.channelName).toHaveLength(
      SLACK_LIMITS.channelName
    );
  });

  test('keeps the latest messages of a long thread', () => {
    const thread = Array.from({ length: SLACK_LIMITS.threadMessages + 5 }, (_, index) => ({
      ts: `200.${index}`,
      userId: 'U2',
      userName: 'Mia',
      text: `Message ${index}`,
    }));
    const parsed = parseSlackMention({ ...WIRE, thread });
    expect(parsed?.thread).toHaveLength(SLACK_LIMITS.threadMessages);
    expect(parsed?.thread[0]?.text).toBe('Message 5');
  });
});

describe('a thread', () => {
  test('is keyed by its workspace, channel and root message', () => {
    const mention = parseSlackMention(WIRE);
    if (!mention) throw new Error('unreadable');
    const thread = resolveSlackMentionThread(mention);
    expect(thread).toEqual({ teamId: 'T1', channelId: 'C1', threadTs: '100.1' });
    expect(resolveSlackThreadKey(thread)).toBe('T1:C1:100.1');
    expect(isSameSlackThread(thread, { ...thread })).toBe(true);
    expect(isSameSlackThread(thread, { ...thread, channelId: 'C2' })).toBe(false);
  });
});
