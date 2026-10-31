import { describe, expect, test } from 'bun:test';
import type { EunoeLink } from '../../../../src/agents/providers/claude/index.ts';
import {
  BLOCKING_LIMIT_ENV,
  DIRECT_BASE_URL,
  resolveClaudeRoute,
} from '../../../../src/agents/providers/claude/route.ts';

function createLink(status: Awaited<ReturnType<EunoeLink['ensure']>>) {
  const asked: string[] = [];
  const link: EunoeLink = {
    ensure: () => {
      asked.push('ensure');
      return Promise.resolve(status);
    },
    watch: () => () => undefined,
    fold: () => () => undefined,
  };
  return { link, asked };
}

const UP = { ok: true as const, url: 'http://127.0.0.1:40001', dir: '/data/eunoe' };

describe('resolveClaudeRoute', () => {
  test('provider compaction talks to Anthropic directly with Claude Code’s own compaction on', async () => {
    const { link, asked } = createLink(UP);
    expect(await resolveClaudeRoute('provider', link)).toEqual({
      env: { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, [BLOCKING_LIMIT_ENV]: '' },
      autoCompact: true,
      eunoe: false,
      notice: null,
    });
    expect(asked).toEqual([]);
  });

  test('off talks to Anthropic directly and never compacts', async () => {
    const route = await resolveClaudeRoute('off', null);
    expect(route).toMatchObject({ autoCompact: false, eunoe: false, notice: null });
    expect(route.env.ANTHROPIC_BASE_URL).toBe(DIRECT_BASE_URL);
  });

  test('the default and compaction only go through Shinsa’s forwarder, with Claude Code’s compaction and limit off', async () => {
    for (const compaction of ['fold', 'compact'] as const) {
      const { link, asked } = createLink(UP);
      expect(await resolveClaudeRoute(compaction, link)).toEqual({
        env: {
          ANTHROPIC_BASE_URL: 'http://127.0.0.1:40001',
          [BLOCKING_LIMIT_ENV]: '1000000000',
          EUNOE_DIR: '/data/eunoe',
        },
        autoCompact: false,
        eunoe: true,
        notice: null,
      });
      expect(asked).toEqual(['ensure']);
    }
  });

  test('when eunoe is down the run goes direct with Claude Code compacting, and says why', async () => {
    const { link } = createLink({ ok: false, reason: 'Eunoe could not start: port in use.' });
    expect(await resolveClaudeRoute('fold', link)).toEqual({
      env: { ANTHROPIC_BASE_URL: DIRECT_BASE_URL, [BLOCKING_LIMIT_ENV]: '' },
      autoCompact: true,
      eunoe: false,
      notice: {
        kind: 'proxy',
        proxy: 'eunoe',
        status: 'unavailable',
        detail: 'Eunoe could not start: port in use.',
      },
    });
    expect((await resolveClaudeRoute('compact', null)).notice).toEqual({
      kind: 'proxy',
      proxy: 'eunoe',
      status: 'unavailable',
      detail: 'Eunoe is not set up in this Shinsa.',
    });
  });
});
