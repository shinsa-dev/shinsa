import { describe, expect, it } from 'bun:test';
import { NOTICE_GROUP_LIMIT, resolveNoticeLine } from '@/lib/chat/notices.ts';

describe('a notice row', () => {
  it('says an account switched and why', () => {
    expect(
      resolveNoticeLine({ kind: 'account', key: 'n', at: 0, email: 'b@example.com', reason: 'usage_limit' })
    ).toEqual({
      icon: 'IconArrowsRepeatRightLeft',
      label: 'Account switched',
      meta: 'b@example.com',
      detail: 'The previous account hit its usage limit.',
    });
  });

  it('says the conversation was compacted and what made it happen', () => {
    expect(resolveNoticeLine({ kind: 'compaction', key: 'n', at: 0, trigger: 'auto', by: 'claude' })).toEqual(
      {
        icon: 'IconBubbleText',
        label: 'Conversation compacted',
        meta: null,
        detail: 'The context filled up, so the agent summarised the conversation.',
      }
    );
    expect(
      resolveNoticeLine({ kind: 'compaction', key: 'n', at: 0, trigger: 'manual', by: 'claude' }).detail
    ).toBe('Summarised while the agent was idle, so the next step starts from a smaller context.');
  });

  it('says Eunoe folded the finished turns, or compacted at the limit without a summary', () => {
    expect(resolveNoticeLine({ kind: 'compaction', key: 'n', at: 0, trigger: 'fold', by: 'eunoe' })).toEqual({
      icon: 'IconLayersTwo',
      label: 'Finished turns folded',
      meta: null,
      detail:
        'Eunoe folded the finished turns to your messages, the output that mattered and the replies. The full transcript stays searchable.',
    });
    expect(resolveNoticeLine({ kind: 'compaction', key: 'n', at: 0, trigger: 'auto', by: 'eunoe' })).toEqual({
      icon: 'IconMinimize',
      label: 'Conversation compacted by Eunoe',
      meta: null,
      detail:
        'The context reached its limit, so Eunoe folded the finished turns instead of summarising them.',
    });
  });

  it('says Eunoe was not there, so Claude Code compacts this run, and that Shinsa tries again', () => {
    expect(
      resolveNoticeLine({ kind: 'proxy', key: 'n', at: 0, detail: 'Eunoe did not answer within 15 s.' })
    ).toEqual({
      icon: 'IconCloudSimpleDisconnected',
      label: 'Eunoe unavailable',
      meta: 'Claude Code compacts this run',
      detail: 'Eunoe did not answer within 15 s. Shinsa tries Eunoe again in a minute.',
    });
    expect(resolveNoticeLine({ kind: 'proxy', key: 'n', at: 0, detail: null }).detail).toBe(
      'Eunoe did not answer. Shinsa tries Eunoe again in a minute.'
    );
  });

  it('says why fast mode is not running, and that the run carries on at standard speed', () => {
    const fast = { kind: 'fast_mode' as const, key: 'n', at: 0, status: 'unavailable' as const };
    expect(resolveNoticeLine({ ...fast, reason: 'model_not_allowed' })).toEqual({
      icon: 'IconSpeedMiddle',
      label: 'Fast mode unavailable',
      meta: null,
      detail: 'This model does not run in fast mode. The run continues at standard speed.',
    });
    expect(resolveNoticeLine({ ...fast, reason: 'tier_not_offered' }).detail).toBe(
      'Codex runs this model at standard speed only. The run continues at standard speed.'
    );
    expect(resolveNoticeLine({ ...fast, reason: 'needs_credits' }).detail).toBe(
      'Fast mode needs usage credits on this account, and Shinsa never turns extra usage on. The run continues at standard speed.'
    );
    expect(resolveNoticeLine({ ...fast, reason: 'credits_unknown' }).detail).toBe(
      'Shinsa could not tell whether this account has usage credits. The run continues at standard speed.'
    );
    for (const reason of [null, 'something_new']) {
      expect(resolveNoticeLine({ ...fast, reason }).detail).toBe(
        'Fast mode is not available right now. The run continues at standard speed.'
      );
    }
    expect(resolveNoticeLine({ ...fast, status: 'cooldown', reason: null })).toEqual({
      icon: 'IconSpeedMiddle',
      label: 'Fast mode paused',
      meta: null,
      detail: 'Fast mode is cooling down after a rate limit. The run continues at standard speed.',
    });
  });

  it('says a conversation was handed to another provider, with how much of it went along', () => {
    const handoff = {
      kind: 'handoff' as const,
      key: 'n',
      at: 0,
      reason: 'provider_switch' as const,
      fromProvider: 'Claude',
      toProvider: 'Codex',
      totalEntries: 140,
      includedEntries: 120,
    };
    expect(resolveNoticeLine(handoff)).toEqual({
      icon: 'IconArrowsRepeat',
      label: 'Conversation handed over',
      meta: 'Codex',
      detail: 'From Claude to Codex. 120 of 140 entries carried over; the oldest were left out.',
    });
    expect(resolveNoticeLine({ ...handoff, includedEntries: 140 }).detail).toBe(
      'From Claude to Codex. All 140 entries carried over.'
    );
  });

  it('says a session was restored from the transcript when it could not be resumed', () => {
    expect(
      resolveNoticeLine({
        kind: 'handoff',
        key: 'n',
        at: 0,
        reason: 'session_restore',
        fromProvider: 'Claude',
        toProvider: 'Claude',
        totalEntries: 1,
        includedEntries: 1,
      })
    ).toEqual({
      icon: 'IconArrowRotateClockwise',
      label: 'Session restored from the transcript',
      meta: null,
      detail:
        'The Claude session could not be resumed, so a new one started from the transcript. 1 entry carried over.',
    });
  });
  it('says a fork started from the source task’s transcript when its session could not be copied', () => {
    expect(
      resolveNoticeLine({
        kind: 'handoff',
        key: 'n',
        at: 0,
        reason: 'fork',
        fromProvider: 'Claude',
        toProvider: 'Claude',
        totalEntries: 3,
        includedEntries: 3,
      })
    ).toEqual({
      icon: 'IconArrowRotateClockwise',
      label: 'Forked from the transcript',
      meta: null,
      detail:
        'The session of the task this one was forked from could not be copied, so a new one started from its transcript. All 3 entries carried over.',
    });
  });
});

describe('the row of what a run loaded', () => {
  const at = { kind: 'extensions' as const, key: 'n', at: 0 };

  it('names each kind it loaded, leaves out the empty ones and adds up the tokens', () => {
    const line = resolveNoticeLine({
      ...at,
      servers: [
        { name: 'sentry', tokens: null },
        { name: 'linear', tokens: 4_200 },
      ],
      skills: Array.from({ length: 10 }, (_, index) => ({ name: `skill-${index}`, tokens: 1_000 + index })),
      plugins: [],
    });
    expect(line.icon).toBe('IconBlocks');
    expect(line.label).toBe('Loaded 2 MCPs, 10 skills');
    expect(line.meta).toBe('~14k tokens');
    expect(line.groups?.map((group) => group.title)).toEqual(['MCPs', 'Skills']);
    expect(line.groups?.[0]?.lines).toEqual([
      { name: 'linear', tokens: '~4.2k tokens' },
      { name: 'sentry', tokens: 'Not measured' },
    ]);
    expect(line.groups?.[0]?.more).toBeNull();
    expect(line.groups?.[1]?.lines).toHaveLength(NOTICE_GROUP_LIMIT);
    expect(line.groups?.[1]?.lines[0]).toEqual({ name: 'skill-9', tokens: '~1k tokens' });
    expect(line.groups?.[1]?.more).toBe('and 2 more');
  });

  it('says what the context optimizer left out until an agent needs it', () => {
    const line = resolveNoticeLine({
      ...at,
      servers: [{ name: 'linear', tokens: 4_200 }],
      skills: [],
      plugins: [],
      deferred: Array.from({ length: 10 }, (_, index) => ({ name: `idle-${index}`, tokens: 100 * index })),
    });
    expect(line.label).toBe('Loaded 1 MCP');
    expect(line.meta).toBe('~4.2k tokens · 10 left out');
    expect(line.groups?.map((group) => group.title)).toEqual(['MCPs', 'Left out until needed']);
    expect(line.groups?.[1]?.lines[0]).toEqual({ name: 'idle-9', tokens: '~900 tokens' });
    expect(line.groups?.[1]?.more).toBe('and 2 more');
    const few = resolveNoticeLine({
      ...at,
      servers: [],
      skills: [],
      plugins: [{ name: 'p', tokens: 1 }],
      deferred: [{ name: 'a', tokens: null }],
    });
    expect(few.groups?.[1]?.more).toBeNull();
  });

  it('leaves the total out when nothing it loaded was measured', () => {
    const line = resolveNoticeLine({
      ...at,
      servers: [],
      skills: [],
      plugins: [{ name: 'stripe', tokens: null }],
    });
    expect(line.label).toBe('Loaded 1 plugin');
    expect(line.meta).toBeNull();
  });

  it('says only Shinsa’s tools were loaded when nothing else was turned on', () => {
    const line = resolveNoticeLine({ ...at, servers: [], skills: [], plugins: [] });
    expect(line.label).toBe('Loaded only Shinsa’s tools');
    expect(line.meta).toBeNull();
    expect(line.groups).toBeUndefined();
    expect(line.detail).toBe('No MCP, skill or plugin was turned on for this run.');
    const deferred = resolveNoticeLine({
      ...at,
      servers: [],
      skills: [],
      plugins: [],
      deferred: [{ name: 'maple', tokens: 4_000 }],
    });
    expect(deferred.meta).toBe('1 left out');
    expect(deferred.groups?.map((group) => group.title)).toEqual(['Left out until needed']);
  });
});
