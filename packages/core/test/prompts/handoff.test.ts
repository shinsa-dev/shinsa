import { describe, expect, test } from 'bun:test';
import {
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEvent,
  resolveHandoff,
  resolveHandoffPrompt,
} from '../../src/index.ts';

let counter = 0;

function entry(event: ChatEvent): ChatEntry {
  counter += 1;
  return { ...event, v: CHAT_PROTOCOL_VERSION, id: `e${counter}`, at: counter } as ChatEntry;
}

const brief = entry({ type: 'user', from: 'shinsa', text: 'Build phase 1.', attachments: [] });

function conversation(...events: ChatEvent[]) {
  return [{ transcriptPath: '/t/run-1.jsonl', entries: [brief, ...events.map(entry)] }];
}

describe('resolveHandoff', () => {
  test('nothing to hand over without a prompt in the history', () => {
    expect(
      resolveHandoff({
        reason: 'session_restore',
        fromProvider: 'Claude',
        sources: [{ transcriptPath: '/t', entries: [entry({ type: 'agent', phase: 'final', text: 'hi' })] }],
      })
    ).toBeNull();
  });

  test('renders the brief, messages, replies and tool activity, and leaves plumbing and subagents out', () => {
    const handoff = resolveHandoff({
      reason: 'session_restore',
      fromProvider: 'Claude',
      sources: conversation(
        {
          type: 'user',
          from: 'you',
          text: 'Use blue.',
          attachments: [
            { kind: 'image', name: 'shot.png', url: '/api/evidence/shot.png', mimeType: null, size: 3 },
          ],
        },
        { type: 'status', status: 'working', outcome: null },
        { type: 'agent', phase: 'interim', text: 'Reading.' },
        { type: 'tool_call', callId: 'c1', tool: { kind: 'read', path: 'a.ts', range: null } },
        { type: 'tool_result', callId: 'c1', status: 'error', output: 'missing', images: [] },
        {
          type: 'tool_call',
          callId: 'c2',
          tool: { kind: 'mcp', server: 'linear', name: 'search', args: {} },
        },
        { type: 'tool_call', callId: 'c3', tool: { kind: 'shinsa', name: 'note', args: {} } },
        { type: 'tool_call', callId: 'c4', tool: { kind: 'other', name: 'Skill', args: {} } },
        { type: 'agent', phase: 'interim', text: 'sub work', parentCallId: 'c9' },
        {
          type: 'notice',
          notice: { kind: 'context', usedTokens: 10, maxTokens: 100, totalProcessedTokens: null },
        },
        { type: 'notice', notice: { kind: 'account', email: 'a@b.c', organization: null, plan: null } },
        {
          type: 'notice',
          notice: {
            kind: 'rate_limit',
            status: 'allowed',
            limit: 'five_hour',
            resetsAt: null,
            utilization: null,
          },
        },
        { type: 'notice', notice: { kind: 'compaction', trigger: 'auto', preTokens: 9, summary: null } },
        {
          type: 'notice',
          notice: { kind: 'compaction', trigger: null, preTokens: null, summary: 'We did X.' },
        },
        { type: 'notice', notice: { kind: 'interrupted' } },
        {
          type: 'notice',
          notice: {
            kind: 'handoff',
            reason: 'provider_switch',
            fromProvider: 'Codex',
            toProvider: 'Claude',
            totalEntries: 2,
            includedEntries: 2,
          },
        },
        { type: 'error', text: 'boom' },
        { type: 'agent', phase: 'final', text: 'Done.' }
      ),
    });
    const text = handoff?.text ?? '';
    expect(text).toStartWith('<system-message>\nYour previous session for this step could not be resumed');
    expect(text).toContain('--- shinsa ---\nBuild phase 1.');
    expect(text).toContain('--- human ---\nUse blue.\n[attached: shot.png (/api/evidence/shot.png)]');
    expect(text).toContain('--- agent tool call: read ---\n{"kind":"read","path":"a.ts","range":null}');
    expect(text).toContain('--- tool result (error) ---\nmissing');
    expect(text).toContain('--- agent tool call: linear.search ---');
    expect(text).toContain('--- agent tool call: note ---');
    expect(text).toContain('--- agent tool call: Skill ---');
    expect(text).toContain(
      '--- summary of the earlier conversation (the agent compacted its context) ---\nWe did X.'
    );
    expect(text).toContain('--- turn interrupted ---');
    expect(text).toContain('--- conversation handed over from Codex to Claude ---');
    expect(text).toContain('--- the turn ended with an error ---\nboom');
    expect(text).toContain('--- agent ---\nDone.');
    expect(text).not.toContain('sub work');
    expect(text).not.toContain('a@b.c');
    expect(text).toContain('The complete record (JSONL, one entry per line) is at: /t/run-1.jsonl.');
    expect(handoff).toMatchObject({ totalEntries: 13, includedEntries: 13, elidedEntries: 0 });
    expect(handoff?.approxTokens).toBe(Math.ceil(text.length / 4));
  });

  test('a switch from another provider says so', () => {
    const handoff = resolveHandoff({
      reason: 'provider_switch',
      fromProvider: 'Codex',
      sources: conversation({ type: 'agent', phase: 'final', text: 'ok' }),
    });
    expect(handoff?.text).toContain('This step is being handed to you from another coding agent (Codex).');
  });

  test('large tool output outside the recent window is left out with a pointer to the transcript', () => {
    const big = 'x'.repeat(3_000);
    const recent = 'y'.repeat(101_000);
    const handoff = resolveHandoff({
      reason: 'session_restore',
      fromProvider: 'Claude',
      sources: conversation(
        { type: 'tool_call', callId: 'c1', tool: { kind: 'write', path: 'a.ts', content: big } },
        { type: 'tool_result', callId: 'c1', status: 'ok', output: big, images: [] },
        { type: 'agent', phase: 'final', text: recent }
      ),
    });
    expect(handoff?.elidedEntries).toBe(2);
    expect(handoff?.text).toMatch(/\[tool input left out \(~\d+ tokens\): entry e\d+ in \/t\/run-1\.jsonl\]/);
    expect(handoff?.text).toMatch(
      /\[tool result left out \(~750 tokens\): entry e\d+ in \/t\/run-1\.jsonl\]/
    );
    expect(handoff?.text).toContain(recent);
  });

  test('over budget, older turns are dropped at a prompt so a call never loses its result, and it says so', () => {
    const handoff = resolveHandoff({
      reason: 'session_restore',
      fromProvider: 'Claude',
      charBudget: 120,
      sources: conversation(
        { type: 'agent', phase: 'final', text: 'a'.repeat(200) },
        { type: 'user', from: 'you', text: 'Next.', attachments: [] },
        { type: 'agent', phase: 'final', text: 'b'.repeat(40) }
      ),
    });
    expect(handoff?.text).toContain(
      '[2 earlier entries left out for length: read the full transcript to see them]'
    );
    expect(handoff?.text).toContain('--- human ---\nNext.');
    expect(handoff?.text).not.toContain('aaaa');
    expect(handoff).toMatchObject({ totalEntries: 4, includedEntries: 2 });
  });

  test('one dropped entry is counted in the singular', () => {
    const handoff = resolveHandoff({
      reason: 'session_restore',
      fromProvider: 'Claude',
      charBudget: 120,
      sources: [
        {
          transcriptPath: '/t/run-1.jsonl',
          entries: [
            entry({ type: 'user', from: 'shinsa', text: 'a'.repeat(200), attachments: [] }),
            entry({ type: 'user', from: 'you', text: 'Next.', attachments: [] }),
            entry({ type: 'agent', phase: 'final', text: 'Done.' }),
          ],
        },
      ],
    });
    expect(handoff?.text).toContain(
      '[1 earlier entry left out for length: read the full transcript to see them]'
    );
  });

  test('with no prompt after the cut, results orphaned by the cut are dropped too', () => {
    const handoff = resolveHandoff({
      reason: 'session_restore',
      fromProvider: 'Claude',
      charBudget: 120,
      sources: conversation(
        { type: 'tool_call', callId: 'c1', tool: { kind: 'todo', todos: [] } },
        { type: 'tool_result', callId: 'c1', status: 'ok', output: 'z'.repeat(60), images: [] },
        { type: 'agent', phase: 'final', text: 'Done.' }
      ),
    });
    expect(handoff?.text).not.toContain('zzzz');
    expect(handoff?.text).toContain('--- agent ---\nDone.');
  });

  test('refuses instead of handing over an empty history when even the latest turn does not fit', () => {
    expect(() =>
      resolveHandoff({
        reason: 'session_restore',
        fromProvider: 'Claude',
        charBudget: 10,
        sources: conversation({ type: 'agent', phase: 'final', text: 'c'.repeat(500) }),
      })
    ).toThrow('too large to hand to a fresh session');
  });
});

describe('resolveHandoffPrompt', () => {
  test('the history leads and the prompt is last, except for a slash command, which must stay first', () => {
    expect(resolveHandoffPrompt('<h/>', 'Carry on.')).toBe('<h/>\n\nCarry on.');
    expect(resolveHandoffPrompt('<h/>', '/review')).toBe('/review\n\n<h/>');
    expect(resolveHandoffPrompt('<h/>', '  ')).toBe('<h/>');
  });
});
