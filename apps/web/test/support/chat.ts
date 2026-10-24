import {
  CHAT_PROTOCOL_VERSION,
  type ChatEntry,
  type ChatEntryOf,
  type ChatTool,
  type ChatToolArgs,
  type ShinsaToolName,
} from '@shinsa/core';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { describeTool } from '@/lib/chat/tool-describe.ts';
import { NOW } from './state.ts';

let sequence = 0;

function nextId(prefix: string) {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function entry<T extends ChatEntry['type']>(
  fields: Omit<ChatEntryOf<T>, 'v' | 'id' | 'at'> & { id?: string; at?: number }
): ChatEntryOf<T> {
  const { id, at, ...rest } = fields;
  return { v: CHAT_PROTOCOL_VERSION, id: id ?? nextId(rest.type), at: at ?? NOW, ...rest } as ChatEntryOf<T>;
}

export function createBrief(text: string, at?: number, id?: string) {
  return entry<'user'>({ type: 'user', from: 'shinsa', text, attachments: [], at, id });
}

export function createUserEntry(
  text: string,
  at?: number,
  attachments: ChatEntryOf<'user'>['attachments'] = []
) {
  return entry<'user'>({ type: 'user', from: 'you', text, attachments, at });
}

export function createAgentEntry(text: string, phase: 'interim' | 'final', at?: number, id?: string) {
  return entry<'agent'>({ type: 'agent', phase, text, at, id });
}

export function createCallEntry(callId: string, tool: ChatTool, at?: number, id?: string) {
  return entry<'tool_call'>({ type: 'tool_call', callId, tool, at, id });
}

export function createResultEntry(
  callId: string,
  output: string,
  at?: number,
  options: { status?: 'ok' | 'error'; images?: string[] } = {}
) {
  return entry<'tool_result'>({
    type: 'tool_result',
    callId,
    output,
    status: options.status ?? 'ok',
    images: options.images ?? [],
    at,
  });
}

export function createStatusEntry(status: ChatEntryOf<'status'>['status'], at?: number) {
  return entry<'status'>({ type: 'status', status, outcome: null, at });
}

export function createErrorEntry(text: string, at?: number, id?: string) {
  return entry<'error'>({ type: 'error', text, at, id });
}

export function readTool(path: string): ChatTool {
  return { kind: 'read', path, range: null };
}

export function commandTool(command: string, description: string | null = null): ChatTool {
  return { kind: 'command', action: 'run', command, description };
}

export function shinsaTool(name: ShinsaToolName, args: ChatToolArgs = {}): ChatTool {
  return { kind: 'shinsa', name, args };
}

export function createToolCall(tool: ChatTool, overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    key: 'call',
    callId: 'call',
    tool,
    description: describeTool(tool),
    result: null,
    images: [],
    failed: false,
    recovery: null,
    ...overrides,
  };
}

export function createNoticeEntry(notice: ChatEntryOf<'notice'>['notice'], at?: number, id?: string) {
  return entry<'notice'>({ type: 'notice', notice, at, id });
}
