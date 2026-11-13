import { describe, expect, test } from 'bun:test';
import { convertClaudeSession } from '../../../../src/agents/providers/claude/import.ts';

const NOW = Date.UTC(2026, 9, 1, 12);

describe('importing a Claude Code session', () => {
  test('a Claude Code session becomes chat entries with the closing reply final', () => {
    const lines = [
      { type: 'user', timestamp: '2026-10-01T10:00:00Z', message: { content: 'Fix the export' } },
      {
        type: 'assistant',
        timestamp: '2026-10-01T10:00:01Z',
        message: {
          content: [
            { type: 'text', text: 'Checking.' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
          ],
        },
      },
      {
        type: 'user',
        timestamp: '2026-10-01T10:00:02Z',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '1\tx' }] },
      },
      {
        type: 'assistant',
        timestamp: '2026-10-01T10:00:03Z',
        message: { content: [{ type: 'text', text: 'Fixed.' }] },
      },
      { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'hidden' }] } },
    ];
    const entries = convertClaudeSession(lines.map((line) => JSON.stringify(line)).join('\n'), NOW);
    expect(entries.map((entry) => entry.type)).toEqual([
      'user',
      'agent',
      'tool_call',
      'tool_result',
      'agent',
    ]);
    expect(entries.every((entry) => entry.v === 2 && entry.id.length > 0)).toBe(true);
    expect(entries.filter((entry) => entry.type === 'agent').map((entry) => entry.phase)).toEqual([
      'interim',
      'final',
    ]);
  });
});

describe('converting edge cases', () => {
  test('bad lines, plain prompts, prompt blocks and untimed lines', () => {
    const lines = [
      'not json',
      '',
      '[1, 2]',
      JSON.stringify({ type: 'user', isMeta: 'yes', message: { content: 'Wrong shape' } }),
      JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'Plain prompt' } }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'text', text: 'Block prompt' }, { type: 'other' }] },
      }),
      JSON.stringify({ type: 'user', message: { content: '<system-reminder>x</system-reminder>' } }),
      JSON.stringify({ type: 'assistant', message: { content: 'not an array' } }),
      JSON.stringify({ type: 'assistant' }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }, { type: 'text' }] } }),
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 5 }, 'loose'] } }),
    ];
    const entries = convertClaudeSession(lines.join('\n'), NOW);
    expect(entries.map((entry) => entry.type)).toEqual(['user', 'user', 'tool_call']);
    expect(entries[0]?.id).toBe('u1');
    expect(entries[1]?.id).toBe('line-5-0');
    expect(entries.every((entry) => entry.at === NOW)).toBe(true);
  });
});
