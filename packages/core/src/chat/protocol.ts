import type { AccountSwitchReason, RunHandoffReason, RunOutcome, ShinsaToolName } from '../domain/index.ts';
import type { LoadedExtensions } from '../protocol/extensions.ts';

export const CHAT_PROTOCOL_VERSION = 2;

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

export type ChatRunStatus = 'started' | 'working' | 'waiting' | 'ended';

export type ChatDelegationEvent = 'started' | 'reported';

export type ChatRateLimitStatus = 'allowed' | 'allowed_warning' | 'rejected';

export type ChatCompactionTrigger = 'auto' | 'manual' | 'fold' | null;

export type ChatCompactor = 'claude' | 'eunoe';

export type ChatFastModeStatus = 'unavailable' | 'cooldown';

export type ChatNotice =
  | { kind: 'interrupted' }
  | {
      kind: 'compaction';
      trigger: ChatCompactionTrigger;
      preTokens: number | null;
      summary: string | null;
      by?: ChatCompactor;
    }
  | { kind: 'context'; usedTokens: number; maxTokens: number | null; totalProcessedTokens: number | null }
  | { kind: 'account'; email: string | null; organization: string | null; plan: string | null }
  | {
      kind: 'rate_limit';
      status: ChatRateLimitStatus;
      limit: string | null;
      resetsAt: number | null;
      utilization: number | null;
    }
  | {
      kind: 'account_switched';
      email: string | null;
      previous: string | null;
      reason: AccountSwitchReason;
    }
  | { kind: 'delegation'; event: ChatDelegationEvent; runIds: string[] }
  | { kind: 'proxy'; proxy: 'eunoe'; status: 'unavailable'; detail: string | null }
  | { kind: 'fast_mode'; status: ChatFastModeStatus; reason: string | null }
  | ({ kind: 'extensions' } & LoadedExtensions)
  | {
      kind: 'handoff';
      reason: RunHandoffReason;
      fromProvider: string;
      toProvider: string;
      totalEntries: number;
      includedEntries: number;
    };

export type ChatEvent =
  | { type: 'user'; from: 'you' | 'shinsa'; text: string; attachments: ChatAttachment[] }
  | { type: 'agent'; phase: 'interim' | 'final'; text: string; parentCallId?: string }
  | { type: 'tool_call'; callId: string; tool: ChatTool; parentCallId?: string }
  | {
      type: 'tool_result';
      callId: string;
      status: 'ok' | 'error';
      output: string;
      images: string[];
      parentCallId?: string;
    }
  | { type: 'status'; status: ChatRunStatus; outcome: RunOutcome | null }
  | { type: 'error'; text: string }
  | { type: 'notice'; notice: ChatNotice };

export type ChatEntry = ChatEvent & { v: typeof CHAT_PROTOCOL_VERSION; id: string; at: number };

export type ChatEntryOf<T extends ChatEvent['type']> = Extract<ChatEntry, { type: T }>;

export function isChatEntry(value: unknown): value is ChatEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { v?: unknown }).v === CHAT_PROTOCOL_VERSION &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

export function isSubagentEvent(event: ChatEvent) {
  return 'parentCallId' in event && event.parentCallId !== undefined;
}

function listFinalReplies(events: ChatEvent[]) {
  const finals = new Set<number>();
  let candidate: number | null = null;
  for (const [index, event] of events.entries()) {
    if (isSubagentEvent(event)) continue;
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
