import { describe, expect, test } from 'bun:test';
import type { EunoeLink, EunoeMode } from '../../../../src/agents/providers/claude/index.ts';
import {
  BLOCKING_LIMIT_ENV,
  DIRECT_BASE_URL,
  resolveClaudeRoute,
} from '../../../../src/agents/providers/claude/route.ts';

function createLink(status: Awaited<ReturnType<EunoeLink['ensure']>>) {
  const asked: { mode: EunoeMode; configDir: string | null }[] = [];
  const link: EunoeLink = {
    ensure: (mode, configDir) => {
      asked.push({ mode, configDir });
      return Promise.resolve(status);
    },
    watch: () => () => undefined,
  };
  return { link, asked };
}

const UP = { ok: true as const, url: 'http://127.0.0.1:40001', dir: '/data/eunoe' };

describe('resolveClaudeRoute', () => {
  test('Claude Code compacting talks to Anthropic directly with its own compaction on', async () => {
    const { link, asked } = createLink(UP);
    expect(await resolveClaudeRoute('claude', link, '/accounts/one')).toEqual({
      env: { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, [BLOCKING_LIMIT_ENV]: '' },
      autoCompact: true,
      eunoe: false,
      notice: null,
    });
    expect(asked).toEqual([]);
  });

  test('off talks to Anthropic directly and never compacts', async () => {
    const route = await resolveClaudeRoute('off', null, null);
    expect(route).toMatchObject({ autoCompact: false, eunoe: false, notice: null });
    expect(route.env.ANTHROPIC_BASE_URL).toBe(DIRECT_BASE_URL);
  });

  test('each eunoe mode goes through the proxy in that mode, with Claude Code’s compaction and limit off', async () => {
    for (const [compaction, mode] of [
      ['eunoe_compact', 'compact'],
      ['eunoe_default', 'default'],
    ] as const) {
      const { link, asked } = createLink(UP);
      expect(await resolveClaudeRoute(compaction, link, '/accounts/one')).toEqual({
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:40001',
          [BLOCKING_LIMIT_ENV]: '1000000000',
          EUNOE_DIR: '/data/eunoe',
        },
        autoCompact: false,
        eunoe: true,
        notice: null,
      });
      expect(asked).toEqual([{ mode, configDir: '/accounts/one' }]);
    }
  });

  test('when eunoe is down the run goes direct with Claude Code compacting, and says why', async () => {
    const { link } = createLink({ ok: false, reason: 'eunoe did not start within 15 s.' });
    expect(await resolveClaudeRoute('eunoe_compact', link, null)).toEqual({
      env: { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, [BLOCKING_LIMIT_ENV]: '' },
      autoCompact: true,
      eunoe: false,
      notice: {
        kind: 'proxy',
        proxy: 'eunoe',
        status: 'unavailable',
        detail: 'eunoe did not start within 15 s.',
      },
    });
    expect((await resolveClaudeRoute('eunoe_default', null, null)).notice).toEqual({
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: 'Eunoe is not set up in this Shinsa.',
    });
  });
});
