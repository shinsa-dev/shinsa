import { describe, expect, test } from 'bun:test';
import {
  COMPACT_PROMPT,
  listBackgroundWork,
  resolveCacheExpiry,
} from '../../../../src/agents/providers/claude/context.ts';

describe('the prompt cache lifetime', () => {
  test('an hour on a subscription, five minutes on an API key, unknown when nothing was written', () => {
    expect(resolveCacheExpiry({ cache_creation: { ephemeral_1h_input_tokens: 5 } }, 10)).toBe(10 + 3_600_000);
    expect(resolveCacheExpiry({ cache_creation: { ephemeral_5m_input_tokens: 5 } }, 10)).toBe(10 + 300_000);
    expect(
      resolveCacheExpiry(
        { cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } },
        10
      )
    ).toBeNull();
    expect(resolveCacheExpiry({ cache_creation: { ephemeral_1h_input_tokens: 'x' } }, 10)).toBeNull();
    expect(resolveCacheExpiry({ input_tokens: 5 }, 10)).toBeNull();
    expect(resolveCacheExpiry(null, 10)).toBeNull();
  });
});

describe('background work', () => {
  test('counts every live task except ambient ones', () => {
    expect([
      ...listBackgroundWork([
        { task_id: 'a' },
        { task_id: 'b', ambient: true },
        { task_id: 'c', ambient: false },
      ]),
    ]).toEqual(['a', 'c']);
  });

  test('compaction is the CLI’s own command', () => {
    expect(COMPACT_PROMPT).toBe('/compact');
  });
});
