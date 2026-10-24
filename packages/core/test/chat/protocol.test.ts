import { describe, expect, test } from 'bun:test';
import {
  type ChatEvent,
  isChatEntry,
  isShinsaToolName,
  isSubagentEvent,
  markFinalReplies,
} from '../../src/index.ts';

function agent(text: string): ChatEvent {
  return { type: 'agent', phase: 'interim', text };
}

function call(callId: string): ChatEvent {
  return { type: 'tool_call', callId, tool: { kind: 'todo', todos: [] } };
}

function result(callId: string): ChatEvent {
  return { type: 'tool_result', callId, status: 'ok', output: '', images: [] };
}

function user(text: string): ChatEvent {
  return { type: 'user', from: 'you', text, attachments: [] };
}

function phases(events: ChatEvent[]) {
  return markFinalReplies(events).flatMap((event) =>
    event.type === 'agent' ? [`${event.text}:${event.phase}`] : []
  );
}

describe('markFinalReplies', () => {
  test('the last agent message of a turn is final and earlier ones are interim', () => {
    expect(
      phases([
        user('go'),
        agent('looking'),
        call('a'),
        result('a'),
        agent('found it'),
        call('b'),
        agent('done'),
      ])
    ).toEqual(['looking:interim', 'found it:interim', 'done:final']);
  });

  test('every turn closes on its own reply', () => {
    expect(phases([agent('first'), user('again'), agent('second'), agent('third')])).toEqual([
      'first:final',
      'second:interim',
      'third:final',
    ]);
  });

  test('a turn that ends on a tool call has no final reply', () => {
    expect(phases([agent('handing over'), call('a'), result('a')])).toEqual(['handing over:interim']);
  });

  test('results and status events do not end a reply', () => {
    expect(
      phases([
        call('a'),
        agent('waiting on the answer'),
        result('a'),
        { type: 'status', status: 'ended', outcome: 'completed' },
      ])
    ).toEqual(['waiting on the answer:final']);
  });
});

describe('chat entries', () => {
  test('only versioned entries count as chat entries', () => {
    expect(isChatEntry({ v: 2, id: 'x', at: 1, type: 'error', text: 'boom' })).toBe(true);
    expect(isChatEntry({ at: 1, kind: 'assistant', text: 'old', tool: null })).toBe(false);
  });

  test('knows Shinsa tools by name', () => {
    expect(isShinsaToolName('complete_phase')).toBe(true);
    expect(isShinsaToolName('Bash')).toBe(false);
  });
});

describe('subagent events', () => {
  test('a subagent’s text never becomes the final reply, and its events are told apart', () => {
    const nested: ChatEvent = { type: 'agent', phase: 'interim', text: 'sub says', parentCallId: 'task-1' };
    expect(
      phases([user('go'), agent('delegating'), call('task-1'), nested, result('task-1'), agent('done')])
    ).toEqual(['delegating:interim', 'sub says:interim', 'done:final']);
    expect(phases([user('go'), agent('waiting'), nested])).toEqual(['waiting:final', 'sub says:interim']);
    expect(isSubagentEvent(nested)).toBe(true);
    expect(isSubagentEvent(agent('main'))).toBe(false);
    expect(isSubagentEvent({ type: 'notice', notice: { kind: 'interrupted' } })).toBe(false);
  });
});
