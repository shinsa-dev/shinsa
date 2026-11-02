import { describe, expect, test } from 'bun:test';
import { Option, Redacted, Schema } from 'effect';
import { SLACK_BOT_SCOPES, SlackApi } from '../../src/integrations/slack.ts';
import { createUpstream, flipTest, runTest, type Upstream } from '../layers.ts';

const TOKEN = Redacted.make('xoxb-token');

const Posted = Schema.Struct({ ok: Schema.Literal(true), ts: Schema.String });

function answerSlack(answer: (method: string) => Response | null) {
  const upstream = createUpstream();
  upstream.handlers.push((call) => {
    const { hostname, pathname } = new URL(call.url);
    return hostname === 'slack.com' ? answer(pathname.replace('/api/', '')) : null;
  });
  return upstream;
}

const unreachable = (upstream: Upstream): Upstream => ({
  ...upstream,
  fetch: (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch,
});

describe('a Slack call', () => {
  test('sends JSON with the bot token and decodes the answer with the schema asked for', async () => {
    const upstream = answerSlack(() => Response.json({ ok: true, ts: '1.000', extra: 1 }));
    const posted = await runTest(
      SlackApi.use((slack) =>
        slack.call(
          'chat.postMessage',
          { token: TOKEN, body: { json: { channel: 'C1', text: 'hi' } } },
          Posted
        )
      ),
      { upstream }
    );
    expect(posted).toEqual({ ok: true, ts: '1.000' });
    const [call] = upstream.calls;
    expect(call?.url).toBe('https://slack.com/api/chat.postMessage');
    expect(call?.method).toBe('POST');
    expect(call?.headers.get('authorization')).toBe('Bearer xoxb-token');
    expect(call?.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(call?.body ?? '')).toEqual({ channel: 'C1', text: 'hi' });
  });

  test('sends a form with no token for the OAuth exchange', async () => {
    const upstream = answerSlack(() => Response.json({ ok: true }));
    await runTest(
      SlackApi.use((slack) =>
        slack.call('oauth.v2.access', { body: { form: { code: 'c', client_id: 'id' } } }, Schema.Unknown)
      ),
      { upstream }
    );
    const [call] = upstream.calls;
    expect(call?.headers.get('authorization')).toBeNull();
    expect(call?.headers.get('content-type')).toBe('application/x-www-form-urlencoded');
    expect(call?.body).toBe('code=c&client_id=id');
  });

  test.each([
    [
      'an error Slack names',
      () => Response.json({ ok: false, error: 'channel_not_found' }),
      'channel_not_found',
    ],
    ['a refusal with no reason', () => Response.json({ ok: false }), 'failed'],
    ['an answer that is not JSON', () => new Response('<html>', { status: 500 }), 'failed'],
    ['an answer without what was asked for', () => Response.json({ ok: true }), 'unexpected_answer'],
  ])('%s fails with its code', async (_, answer, code) => {
    const error = await flipTest(
      SlackApi.use((slack) =>
        slack.call('chat.postMessage', { token: TOKEN, body: { empty: true } }, Posted)
      ),
      { upstream: answerSlack(answer) }
    );
    expect(error).toMatchObject({ _tag: 'SlackCallFailed', method: 'chat.postMessage', code });
  });

  test('Slack out of reach fails as unreachable', async () => {
    const error = await flipTest(
      SlackApi.use((slack) => slack.call('chat.postMessage', { body: { empty: true } }, Posted)),
      { upstream: unreachable(createUpstream()) }
    );
    expect(error.code).toBe('unreachable');
  });
});

describe("a Slack user's name", () => {
  test.each([
    [
      'the display name first',
      { name: 'm', profile: { display_name: 'Mona', real_name: 'Mona Lisa' } },
      'Mona',
    ],
    [
      'the real name when there is no display name',
      { name: 'm', profile: { display_name: '', real_name: 'Mona Lisa' } },
      'Mona Lisa',
    ],
    ['the user name when the profile has neither', { name: 'm' }, 'm'],
  ])('is %s', async (_, user, name) => {
    const upstream = answerSlack(() => Response.json({ ok: true, user }));
    const found = await runTest(
      SlackApi.use((slack) => slack.selectUserName(TOKEN, 'U1')),
      { upstream }
    );
    expect(found).toEqual(Option.some(name));
    expect(upstream.calls[0]?.body).toBe('user=U1');
  });

  test('is none when Slack has no name or does not answer', async () => {
    const names = await Promise.all([
      runTest(
        SlackApi.use((slack) => slack.selectUserName(TOKEN, 'U1')),
        {
          upstream: answerSlack(() => Response.json({ ok: true, user: { profile: {} } })),
        }
      ),
      runTest(
        SlackApi.use((slack) => slack.selectUserName(TOKEN, 'U1')),
        {
          upstream: answerSlack(() => Response.json({ ok: false, error: 'user_not_found' })),
        }
      ),
    ]);
    expect(names.every(Option.isNone)).toBe(true);
  });
});

describe("the bot's scopes", () => {
  const hasScopes = (upstream: Upstream) =>
    runTest(
      SlackApi.use((slack) => slack.hasBotScopes(TOKEN)),
      { upstream }
    );

  test('are enough when Slack grants every one the bot needs', async () => {
    const granted = SLACK_BOT_SCOPES.join(', ');
    expect(
      await hasScopes(
        answerSlack(() => Response.json({ ok: true }, { headers: { 'x-oauth-scopes': granted } }))
      )
    ).toBe(true);
  });

  test('are not enough when one is missing', async () => {
    const granted = SLACK_BOT_SCOPES.slice(1).join(',');
    expect(
      await hasScopes(
        answerSlack(() => Response.json({ ok: true }, { headers: { 'x-oauth-scopes': granted } }))
      )
    ).toBe(false);
  });

  test('are taken as enough when Slack does not say or does not answer, so a link is never blocked on a guess', async () => {
    expect(await hasScopes(answerSlack(() => Response.json({ ok: true })))).toBe(true);
    expect(await hasScopes(unreachable(createUpstream()))).toBe(true);
  });
});
