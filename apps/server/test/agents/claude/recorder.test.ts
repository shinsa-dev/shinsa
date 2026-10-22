import { describe, expect, test } from 'bun:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent } from '@shinsa/core';
import { createClaudeRecorder } from '../../../src/agents/claude/recorder.ts';

function message(value: unknown) {
  return value as SDKMessage;
}

function assistant(content: unknown[]) {
  return message({ type: 'assistant', parent_tool_use_id: null, message: { content } });
}

describe('live recording', () => {
  test('text between tool calls is interim and the closing reply is final', () => {
    const events: ChatEvent[] = [];
    const recorder = createClaudeRecorder((event) => events.push(event));
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

  test("a subagent's own messages stay out of the run", () => {
    const events: ChatEvent[] = [];
    const recorder = createClaudeRecorder((event) => events.push(event));
    recorder.record(
      message({
        type: 'assistant',
        parent_tool_use_id: 'task-1',
        message: { content: [{ type: 'text', text: 'x' }] },
      })
    );
    recorder.flush('interim');
    expect(events).toEqual([]);
  });
});
