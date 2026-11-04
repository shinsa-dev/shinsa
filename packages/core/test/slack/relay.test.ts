import { describe, expect, test } from 'bun:test';
import {
  listSlackMentionedUsers,
  parseSlackRelayPost,
  parseSlackRelayReaction,
  parseSlackRelaySession,
  resolveSlackConnectUrl,
  resolveSlackLastUsedAt,
  resolveSlackLinkedPath,
  resolveSlackReadableText,
  resolveSlackTaskUrl,
  resolveSlackThreadUrl,
  SLACK_RELAY_MESSAGE_LIMITS,
} from '../../src/index.ts';
import { createHarness, createTask } from '../harness.ts';

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

describe('when a Slack account last started work on this machine', () => {
  function stateWith(links: Record<string, { teamId: string; userId: string } | null>) {
    const harness = createHarness();
    const ids = Object.keys(links).map(() => createTask(harness));
    const state = harness.state;
    const tasks = Object.fromEntries(
      Object.values(links).map((link, index) => {
        const task = state.tasks[ids[index] ?? ''];
        if (!task) throw new Error('missing task');
        const slack = link && {
          ...link,
          channelId: 'C1',
          threadTs: `${index}.1`,
          messageTs: `${index}.1`,
          permalink: null,
          channelName: null,
          statusTs: null,
          reaction: null,
        };
        return [task.id, { ...task, createdAt: (index + 1) * 1_000, ...(slack ? { slack } : {}) }];
      })
    );
    return { ...state, tasks };
  }

  test('is the newest task started by that user in that workspace', () => {
    const state = stateWith({
      first: { teamId: 'T1', userId: 'U1' },
      newest: { teamId: 'T1', userId: 'U1' },
      otherUser: { teamId: 'T1', userId: 'U2' },
      otherTeam: { teamId: 'T2', userId: 'U1' },
      typed: null,
    });
    expect(resolveSlackLastUsedAt(state, { teamId: 'T1', userId: 'U1' })).toBe(2_000);
    expect(resolveSlackLastUsedAt(state, { teamId: 'T1', userId: 'U2' })).toBe(3_000);
    expect(resolveSlackLastUsedAt(state, { teamId: 'T2', userId: 'U1' })).toBe(4_000);
  });

  test('is null for an account that has not started a task here', () => {
    const state = stateWith({ typed: null, other: { teamId: 'T1', userId: 'U2' } });
    expect(resolveSlackLastUsedAt(state, { teamId: 'T1', userId: 'U1' })).toBeNull();
  });
});

describe('the Slack thread a task came from', () => {
  const LINK = {
    teamId: 'T1',
    channelId: 'C1',
    threadTs: '100.1',
    userId: 'U1',
    messageTs: '100.2',
    permalink: null,
    channelName: null,
    statusTs: null,
    reaction: null,
  };

  test('opens the mention’s permalink when Slack gave one', () => {
    const permalink = 'https://acme.slack.com/archives/C1/p1002?thread_ts=100.1';
    expect(resolveSlackThreadUrl({ ...LINK, permalink })).toBe(permalink);
  });

  test('opens the thread in Slack’s web client without one', () => {
    expect(resolveSlackThreadUrl(LINK)).toBe('https://app.slack.com/client/T1/C1/thread/C1-100.1');
  });
});
