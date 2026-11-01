import { describe, expect, test } from 'bun:test';
import {
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEvent,
  redactTranscript,
  resolveShareTranscriptFile,
} from '../../src/index.ts';

let next = 0;

function entry(event: ChatEvent): ChatEntry {
  next += 1;
  return { ...event, v: CHAT_PROTOCOL_VERSION, id: `e${next}`, at: next } as ChatEntry;
}

const SECRET = 'sk-live-0000';

describe('a shared transcript', () => {
  test('keeps the agent output and tool calls, never your turns or the prompts Shinsa sends', () => {
    const shared = redactTranscript([
      entry({ type: 'user', from: 'shinsa', text: `Build phase 1. ${SECRET}`, attachments: [] }),
      entry({ type: 'user', from: 'you', text: `Use ${SECRET}`, attachments: [] }),
      entry({ type: 'agent', phase: 'final', text: 'Done.' }),
      entry({ type: 'tool_call', callId: 'c1', tool: { kind: 'read', path: 'a.ts', range: null } }),
      entry({ type: 'tool_result', callId: 'c1', status: 'ok', output: 'x', images: ['/api/a.png'] }),
      entry({ type: 'status', status: 'ended', outcome: 'completed' }),
      entry({ type: 'error', text: 'Retrying.' }),
    ]);
    expect(shared.map((item) => item.type)).toEqual(['agent', 'tool_call', 'tool_result', 'status', 'error']);
    expect(JSON.stringify(shared)).not.toContain(SECRET);
    expect(shared.find((item) => item.type === 'tool_result')).toMatchObject({ images: [] });
  });

  test('drops questions to you, secrets and delegated briefs with their answers', () => {
    const shared = redactTranscript([
      entry({
        type: 'tool_call',
        callId: 'a',
        tool: { kind: 'shinsa', name: 'ask', args: { question: 'Which?' } },
      }),
      entry({
        type: 'tool_result',
        callId: 'a',
        status: 'ok',
        output: `The human answered: ${SECRET}`,
        images: [],
      }),
      entry({
        type: 'tool_call',
        callId: 'd',
        tool: { kind: 'shinsa', name: 'delegate_task', args: { brief: SECRET } },
      }),
      entry({ type: 'tool_result', callId: 'd', status: 'ok', output: SECRET, images: [] }),
      entry({
        type: 'tool_call',
        callId: 'n',
        tool: { kind: 'shinsa', name: 'note', args: { note: 'Kept.' } },
      }),
    ]);
    expect(shared.map((item) => item.id)).toHaveLength(1);
    expect(JSON.stringify(shared)).not.toContain(SECRET);
  });

  test('keeps a subagent call without its prompt', () => {
    const [call] = redactTranscript([
      entry({
        type: 'tool_call',
        callId: 't',
        tool: { kind: 'task', description: 'Search', prompt: SECRET, agent: 'Explore' },
      }),
    ]);
    expect(call).toMatchObject({ tool: { kind: 'task', description: 'Search', prompt: null } });
  });

  test('keeps only notices that say nothing about you or your accounts', () => {
    const shared = redactTranscript([
      entry({
        type: 'notice',
        notice: { kind: 'account', email: 'mona@x.dev', organization: null, plan: null },
      }),
      entry({
        type: 'notice',
        notice: { kind: 'account_switched', email: 'mona@x.dev', previous: null, reason: 'usage_limit' },
      }),
      entry({ type: 'notice', notice: { kind: 'interrupted' } }),
      entry({
        type: 'notice',
        notice: { kind: 'compaction', trigger: 'auto', preTokens: 10, summary: SECRET, by: 'claude' },
      }),
    ]);
    expect(shared.map((item) => (item.type === 'notice' ? item.notice.kind : item.type))).toEqual([
      'interrupted',
      'compaction',
    ]);
    expect(JSON.stringify(shared)).not.toContain('mona@x.dev');
    expect(JSON.stringify(shared)).not.toContain(SECRET);
  });

  test('names a run transcript file after the run', () => {
    expect(resolveShareTranscriptFile('run-1')).toBe('transcript-run-1');
  });
});
