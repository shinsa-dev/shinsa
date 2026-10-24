import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent } from '@shinsa/core';
import {
  createClaudeRecorder,
  resolveContextWindow,
  resolveRateLimitNotice,
  resolveUsageSnapshot,
} from '../../../../src/agents/providers/claude/recorder.ts';

function message(value: unknown) {
  return value as SDKMessage;
}

function assistant(content: unknown[], parent: string | null = null, extra: Record<string, unknown> = {}) {
  return message({
    type: 'assistant',
    parent_tool_use_id: parent,
    uuid: 'u1',
    message: { content, ...extra },
  });
}

function toolResult(parent: string | null) {
  return message({
    type: 'user',
    parent_tool_use_id: parent,
    message: {
      content: [
        { type: 'text', text: 'ignored' },
        { type: 'tool_result', tool_use_id: 't2', content: 'ok' },
      ],
    },
  });
}

function start() {
  const events: ChatEvent[] = [];
  const recorder = createClaudeRecorder((event) => events.push(event));
  return { events, recorder };
}

describe('live recording', () => {
  test('text between tool calls is interim and the closing reply is final', () => {
    const { events, recorder } = start();
    recorder.record(assistant([{ type: 'text', text: 'Looking around.' }]));
    recorder.record(assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]));
    recorder.record(
      message({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts' }] },
      })
    );
    recorder.record(
      assistant([
        { type: 'text', text: 'Found it.' },
        { type: 'text', text: 'All done.' },
      ])
    );
    recorder.record(message({ type: 'result', subtype: 'success', result: 'All done.' }));
    expect(
      events.map((event) => (event.type === 'agent' ? `${event.text}:${event.phase}` : event.type))
    ).toEqual([
      'Looking around.:interim',
      'tool_call',
      'tool_result',
      'Found it.:interim',
      'All done.:final',
    ]);
  });

  test('a subagent’s text, calls and results are kept, tagged with the call that started it', () => {
    const { events, recorder } = start();
    recorder.record(assistant([{ type: 'text', text: 'Delegating.' }]));
    recorder.record(
      assistant(
        [
          { type: 'text', text: 'Sub reading.' },
          { type: 'text', text: '  ' },
          { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a.ts' } },
        ],
        'task-1'
      )
    );
    recorder.record(toolResult('task-1'));
    recorder.record(message({ type: 'result', subtype: 'success', result: 'Delegating.' }));
    expect(events).toMatchObject([
      { type: 'agent', phase: 'interim', text: 'Sub reading.', parentCallId: 'task-1' },
      { type: 'tool_call', callId: 't2', parentCallId: 'task-1', tool: { kind: 'read' } },
      { type: 'tool_result', callId: 't2', parentCallId: 'task-1' },
      { type: 'agent', phase: 'final', text: 'Delegating.' },
    ]);
    expect(events[3]).not.toHaveProperty('parentCallId');
  });

  test('compaction leaves a boundary and its summary', () => {
    const { events, recorder } = start();
    recorder.record(
      message({
        type: 'system',
        subtype: 'compact_boundary',
        compact_metadata: { trigger: 'auto', pre_tokens: 180_000 },
      })
    );
    recorder.record(
      message({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: 'This session is being continued from a previous conversation. Summary: X.' },
      })
    );
    recorder.record(
      message({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'This session is being continued. Y.' }] },
      })
    );
    recorder.record(message({ type: 'user', parent_tool_use_id: null, message: { content: 'Plain text.' } }));
    recorder.record(
      message({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'image' }] } })
    );
    recorder.record(
      message({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'Hi' }] },
      })
    );
    recorder.record(message({ type: 'system', subtype: 'init', session_id: 's' }));
    recorder.record(message({ type: 'stream_event' }));
    expect(events).toEqual([
      { type: 'notice', notice: { kind: 'compaction', trigger: 'auto', preTokens: 180_000, summary: null } },
      {
        type: 'notice',
        notice: {
          kind: 'compaction',
          trigger: null,
          preTokens: null,
          summary: 'This session is being continued from a previous conversation. Summary: X.',
        },
      },
      {
        type: 'notice',
        notice: {
          kind: 'compaction',
          trigger: null,
          preTokens: null,
          summary: 'This session is being continued. Y.',
        },
      },
    ]);
  });

  test('a rate-limit event is noted when it changes, not on every repeat', () => {
    const { events, recorder } = start();
    const info = { status: 'allowed_warning', rateLimitType: 'five_hour', resetsAt: 100, utilization: 0.9 };
    recorder.record(message({ type: 'rate_limit_event', rate_limit_info: info }));
    recorder.record(message({ type: 'rate_limit_event', rate_limit_info: info }));
    recorder.record(message({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }));
    expect(events).toEqual([
      {
        type: 'notice',
        notice: {
          kind: 'rate_limit',
          status: 'allowed_warning',
          limit: 'five_hour',
          resetsAt: 100_000,
          utilization: 0.9,
        },
      },
      {
        type: 'notice',
        notice: { kind: 'rate_limit', status: 'rejected', limit: null, resetsAt: null, utilization: null },
      },
    ]);
    expect(resolveRateLimitNotice({ status: 'allowed' })).toMatchObject({ limit: null });
  });
});

describe('context usage', () => {
  test('keeps the main thread’s latest per-step usage, once per message, with the window from the last result', () => {
    const { recorder } = start();
    recorder.record(
      message({
        type: 'result',
        subtype: 'success',
        result: '',
        modelUsage: { opus: { contextWindow: 200_000 } },
      })
    );
    const usage = {
      input_tokens: 10,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 80,
      output_tokens: 5,
    };
    recorder.record(assistant([], null, { id: 'm1', usage }));
    recorder.record(assistant([], null, { id: 'm1', usage: { input_tokens: 999 } }));
    recorder.record(assistant([], 'task-1', { id: 'm2', usage: { input_tokens: 5_000 } }));
    expect(recorder.takeUsage()).toEqual({ usedTokens: 100, maxTokens: 200_000 });
    expect(recorder.takeUsage()).toBeNull();
  });

  test('a snapshot taken before the window is known picks it up later', () => {
    const { recorder } = start();
    recorder.record(assistant([], null, { usage: { inputTokens: 7 } }));
    recorder.record(
      message({
        type: 'result',
        subtype: 'success',
        result: '',
        modelUsage: { a: { context_window: 1_000 } },
      })
    );
    expect(recorder.takeUsage()).toEqual({ usedTokens: 7, maxTokens: 1_000 });
  });

  test('usage and windows that are missing or empty count as unknown', () => {
    expect(resolveUsageSnapshot(null, null)).toBeNull();
    expect(resolveUsageSnapshot({ input_tokens: 0 }, null)).toBeNull();
    expect(resolveUsageSnapshot({ input_tokens: 'x' }, 5)).toBeNull();
    expect(resolveContextWindow(null)).toBeNull();
    expect(resolveContextWindow({ a: null, b: { contextWindow: 0 }, c: { contextWindow: 9 } })).toBe(9);
  });
});
