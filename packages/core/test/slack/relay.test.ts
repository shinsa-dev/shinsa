import { describe, expect, test } from 'bun:test';
import {
  listSlackMentionedUsers,
  parseSlackRelayPost,
  parseSlackRelayReaction,
  parseSlackRelaySession,
  resolveSlackConnectUrl,
  resolveSlackLinkedPath,
  resolveSlackReadableText,
  resolveSlackTaskUrl,
  SLACK_RELAY_MESSAGE_LIMITS,
} from '../../src/index.ts';

describe('a machine’s post through the relay', () => {
  const POST = {
    teamId: 'T1',
    channelId: 'C1',
    threadTs: '100.1',
    replaceTs: null,
    message: { text: 'Planning', blocks: [{ type: 'section' }] },
  };

  test('reads a new post and an edit of an earlier one', () => {
    expect(parseSlackRelayPost(POST)).toEqual(POST);
    expect(parseSlackRelayPost({ ...POST, replaceTs: '100.5' })?.replaceTs).toBe('100.5');
    expect(parseSlackRelayPost({ ...POST, replaceTs: undefined })?.replaceTs).toBeNull();
  });

  test('refuses a broken id, a bad edit target, an empty or oversized message and blocks that are not objects', () => {
    expect(parseSlackRelayPost('post')).toBeNull();
    expect(parseSlackRelayPost({ ...POST, teamId: 'T 1' })).toBeNull();
    expect(parseSlackRelayPost({ ...POST, channelId: '' })).toBeNull();
    expect(parseSlackRelayPost({ ...POST, threadTs: 4 })).toBeNull();
    expect(parseSlackRelayPost({ ...POST, replaceTs: 'x y' })).toBeNull();
    expect(parseSlackRelayPost({ ...POST, message: null })).toBeNull();
    expect(parseSlackRelayPost({ ...POST, message: { text: '', blocks: [] } })).toBeNull();
    expect(
      parseSlackRelayPost({
        ...POST,
        message: { text: 'x'.repeat(SLACK_RELAY_MESSAGE_LIMITS.text + 1), blocks: [] },
      })
    ).toBeNull();
    expect(parseSlackRelayPost({ ...POST, message: { text: 'x', blocks: 'none' } })).toBeNull();
    expect(
      parseSlackRelayPost({
        ...POST,
        message: {
          text: 'x',
          blocks: Array.from({ length: SLACK_RELAY_MESSAGE_LIMITS.blocks + 1 }, () => ({})),
        },
      })
    ).toBeNull();
    expect(parseSlackRelayPost({ ...POST, message: { text: 'x', blocks: ['section'] } })).toBeNull();
  });
});

describe('a machine’s thread status through the relay', () => {
  const THREAD = { teamId: 'T1', channelId: 'C1', threadTs: '100.1' };

  test('reads a status Slack knows and refuses any other', () => {
    expect(parseSlackRelaySession({ ...THREAD, status: 'suspended' })).toEqual({
      ...THREAD,
      status: 'suspended',
    });
    expect(parseSlackRelaySession({ ...THREAD, status: 'thinking' })).toBeNull();
    expect(parseSlackRelaySession({ ...THREAD, teamId: '', status: 'active' })).toBeNull();
    expect(parseSlackRelaySession('active')).toBeNull();
  });

  test('a reaction names its message and the emoji it adds or takes off, at least one of them', () => {
    const reaction = { ...THREAD, messageTs: '100.3', add: 'white_check_mark', remove: 'hammer_and_wrench' };
    expect(parseSlackRelayReaction(reaction)).toEqual(reaction);
    expect(parseSlackRelayReaction({ ...reaction, remove: undefined })).toEqual({
      ...reaction,
      remove: null,
    });
    expect(parseSlackRelayReaction({ ...reaction, add: null })).toEqual({ ...reaction, add: null });
    expect(parseSlackRelayReaction({ ...reaction, add: null, remove: null })).toBeNull();
    expect(parseSlackRelayReaction({ ...reaction, add: 'Not An Emoji' })).toBeNull();
    expect(parseSlackRelayReaction({ ...reaction, remove: 7 })).toBeNull();
    expect(parseSlackRelayReaction({ ...reaction, messageTs: '' })).toBeNull();
    expect(parseSlackRelayReaction({ ...reaction, teamId: '' })).toBeNull();
    expect(parseSlackRelayReaction('react')).toBeNull();
  });
});

describe('a mention as the person wrote it', () => {
  const names = { users: new Map([['U2', 'Mia']]), botUserId: 'B0T' };

  test('drops the bot’s own mention and names the people, channels and groups in it', () => {
    expect(
      resolveSlackReadableText(
        '<@B0T> ask <@U2> and <@U9|sam> in <#C1|ops>, <!here> <!subteam^S1|@web>',
        names
      )
    ).toBe('ask @Mia and @U9 in #ops, @here @web');
  });

  test('keeps links readable and undoes Slack’s escapes', () => {
    expect(
      resolveSlackReadableText(
        'see <https://a.dev/x|the log> and <https://b.dev> if a &lt; b &amp;&amp; c &gt; d',
        {
          users: new Map(),
          botUserId: null,
        }
      )
    ).toBe('see the log (https://a.dev/x) and https://b.dev if a < b && c > d');
  });

  test('lists each person it mentions once', () => {
    expect(listSlackMentionedUsers('<@U1> <@U2|mia> <@U1>')).toEqual(['U1', 'U2']);
  });
});

describe('the page after connecting Slack', () => {
  test('names the workspace, or the problem', () => {
    expect(resolveSlackLinkedPath({ team: 'Acme' })).toBe('/slack/linked?team=Acme');
    expect(resolveSlackLinkedPath({ error: 'slack_denied' })).toBe('/slack/linked?error=slack_denied');
  });
});

describe('links back to app.shinsa.dev', () => {
  test('connecting names the machine, and a task opens in the dashboard', () => {
    expect(resolveSlackConnectUrl('https://app.shinsa.dev', 'k3 x')).toBe(
      'https://app.shinsa.dev/slack/connect?instance=k3%20x'
    );
    expect(resolveSlackTaskUrl('https://app.shinsa.dev', 'id-1')).toBe('https://app.shinsa.dev/tasks/id-1');
  });
});
