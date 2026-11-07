import { describe, expect, test } from 'bun:test';
import { listSlackMessageLinks, SLACK_LIMITS } from '../../src/index.ts';

const ROOT = 'https://acme.slack.com/archives/C9ABC/p1730120000123456';

describe('the Slack message links in a mention', () => {
  test('reads a thread root link, in Slack’s markup or bare, as its channel and thread', () => {
    expect(listSlackMessageLinks(`<@U0BOT> look at <${ROOT}|this thread>`)).toEqual([
      { channelId: 'C9ABC', threadTs: '1730120000.123456', permalink: ROOT },
    ]);
    expect(listSlackMessageLinks(`see ${ROOT} please`)).toEqual([
      { channelId: 'C9ABC', threadTs: '1730120000.123456', permalink: ROOT },
    ]);
  });

  test('reads a reply’s link as the thread it belongs to, with Slack’s escaped ampersands', () => {
    const reply =
      'https://acme.slack.com/archives/G42/p1730120500000001?cid=G42&amp;thread_ts=1730120000.123456';
    expect(listSlackMessageLinks(`<${reply}>`)).toEqual([
      { channelId: 'G42', threadTs: '1730120000.123456', permalink: reply },
    ]);
    const odd = 'https://acme.slack.com/archives/G42/p1730120500000001?thread_ts=nope';
    expect(listSlackMessageLinks(odd)[0]?.threadTs).toBe('1730120500.000001');
  });

  test('reads Enterprise Grid hosts, and never a DM, another site or a link without a message', () => {
    expect(
      listSlackMessageLinks('https://acme.enterprise.slack.com/archives/C1/p1730120000123456')
    ).toHaveLength(1);
    expect(listSlackMessageLinks('https://acme.slack.com/archives/D1/p1730120000123456')).toEqual([]);
    expect(listSlackMessageLinks('https://slack.com.evil.test/archives/C1/p1730120000123456')).toEqual([]);
    expect(listSlackMessageLinks('http://acme.slack.com/archives/C1/p1730120000123456')).toEqual([]);
    expect(listSlackMessageLinks('https://acme.slack.com/archives/C1')).toEqual([]);
  });

  test('keeps each thread once, at most three, and skips a link longer than a permalink may be', () => {
    const links = ['C1', 'C1', 'C2', 'C3', 'C4'].map(
      (channel) => `https://acme.slack.com/archives/${channel}/p1730120000123456`
    );
    expect(listSlackMessageLinks(links.join(' ')).map((link) => link.channelId)).toEqual(['C1', 'C2', 'C3']);
    expect(SLACK_LIMITS.linkedThreads).toBe(3);
    const long = `${ROOT}?x=${'a'.repeat(SLACK_LIMITS.permalink)}`;
    expect(listSlackMessageLinks(`${long} ${ROOT}`)).toEqual([
      { channelId: 'C9ABC', threadTs: '1730120000.123456', permalink: ROOT },
    ]);
  });
});
