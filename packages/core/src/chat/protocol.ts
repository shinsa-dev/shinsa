import type { RunOutcome } from '../model/index.ts';

export const CHAT_PROTOCOL_VERSION = 2;

export const SHINSA_TOOL_NAMES = [
  'propose_plan',
  'complete_phase',
  'complete_fix',
  'report_review',
  'ask',
  'attach_evidence',
  'find_tasks',
  'note',
] as const;

export type ShinsaToolName = (typeof SHINSA_TOOL_NAMES)[number];

export type ChatToolArgs = Record<string, unknown>;

export interface ChatAttachment {
  kind: 'image' | 'file';
  name: string;
  url: string;
  mimeType: string | null;
  size: number | null;
}

export interface ChatLineRange {
  start: number;
  end: number | null;
}

export interface ChatEditHunk {
  before: string;
  after: string;
}

export type ChatTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface ChatTodo {
  text: string;
  status: ChatTodoStatus;
}

export type ChatBrowserAction =
  | 'navigate'
  | 'back'
  | 'click'
  | 'hover'
  | 'drag'
  | 'select'
  | 'type'
  | 'fill'
  | 'press'
  | 'screenshot'
  | 'snapshot'
  | 'find'
  | 'resize'
  | 'evaluate'
  | 'wait'
  | 'console'
  | 'network'
  | 'tabs'
  | 'close'
  | 'other';

export type ChatTool =
  | { kind: 'read'; path: string; range: ChatLineRange | null }
  | { kind: 'write'; path: string; content: string }
  | { kind: 'edit'; path: string; hunks: ChatEditHunk[] }
  | { kind: 'command'; action: 'run' | 'output' | 'stop'; command: string; description: string | null }
  | { kind: 'search'; mode: 'content' | 'files' | 'list'; query: string; path: string | null }
  | { kind: 'fetch'; url: string | null; query: string | null; prompt: string | null }
  | {
      kind: 'browser';
      action: ChatBrowserAction;
      name: string;
      target: string | null;
      code: string | null;
      args: ChatToolArgs;
    }
  | { kind: 'task'; description: string; prompt: string | null; agent: string | null }
  | { kind: 'todo'; todos: ChatTodo[] }
  | { kind: 'mcp'; server: string; name: string; args: ChatToolArgs }
  | { kind: 'shinsa'; name: ShinsaToolName; args: ChatToolArgs }
  | { kind: 'other'; name: string; args: ChatToolArgs };

export type ChatToolKind = ChatTool['kind'];

export type ChatRunStatus = 'started' | 'working' | 'waiting' | 'ended';

export type ChatEvent =
  | { type: 'user'; from: 'you' | 'shinsa'; text: string; attachments: ChatAttachment[] }
  | { type: 'agent'; phase: 'interim' | 'final'; text: string }
  | { type: 'tool_call'; callId: string; tool: ChatTool }
  | { type: 'tool_result'; callId: string; status: 'ok' | 'error'; output: string; images: string[] }
  | { type: 'status'; status: ChatRunStatus; outcome: RunOutcome | null }
  | { type: 'error'; text: string };

export type ChatEntry = ChatEvent & { v: typeof CHAT_PROTOCOL_VERSION; id: string; at: number };

export type ChatEntryOf<T extends ChatEvent['type']> = Extract<ChatEntry, { type: T }>;

export function isShinsaToolName(name: string): name is ShinsaToolName {
  return (SHINSA_TOOL_NAMES as readonly string[]).includes(name);
}

export function isChatEntry(value: unknown): value is ChatEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { v?: unknown }).v === CHAT_PROTOCOL_VERSION &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function listFinalReplies(events: ChatEvent[]) {
  const finals = new Set<number>();
  let candidate: number | null = null;
  for (const [index, event] of events.entries()) {
    if (event.type === 'user') {
      if (candidate !== null) finals.add(candidate);
      candidate = null;
    } else if (event.type === 'agent') {
      candidate = index;
    } else if (event.type === 'tool_call') {
      candidate = null;
    }
  }
  if (candidate !== null) finals.add(candidate);
  return finals;
}

export function markFinalReplies<T extends ChatEvent>(events: T[]): T[] {
  const finals = listFinalReplies(events);
  return events.map((event, index) => {
    if (event.type !== 'agent') return event;
    const phase = finals.has(index) ? 'final' : 'interim';
    return event.phase === phase ? event : { ...event, phase };
  });
}
