import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent, markFinalReplies } from '@shinsa/core';
import { mapClaudePrompt, mapLegacyClaudeTool, mapToolResult } from '../providers/claude/map.ts';

export interface LegacyTranscriptEntry {
  at: number;
  kind: 'prompt' | 'assistant' | 'tool' | 'tool_result' | 'error';
  text: string;
  tool: string | null;
  toolUseId?: string | null;
  isError?: boolean;
  input?: string | null;
  source?: 'shinsa' | 'you' | null;
  images?: string[];
}

export interface TimedEvent {
  at: number;
  id: string;
  event: ChatEvent;
}

export function createChatEntries(timed: TimedEvent[]): ChatEntry[] {
  const events = markFinalReplies(timed.map((item) => item.event));
  return timed.map((item, index) => ({
    ...(events[index] ?? item.event),
    v: CHAT_PROTOCOL_VERSION,
    id: item.id,
    at: item.at,
  }));
}

function migrateLegacyEntry(entry: LegacyTranscriptEntry): ChatEvent | null {
  switch (entry.kind) {
    case 'prompt':
      return mapClaudePrompt(entry.text, entry.source === 'you' ? 'you' : 'shinsa');
    case 'assistant':
      return { type: 'agent', phase: 'interim', text: entry.text };
    case 'tool':
      return {
        type: 'tool_call',
        callId: entry.toolUseId ?? '',
        tool: mapLegacyClaudeTool(entry.tool ?? '', entry.input ?? null, entry.text),
      };
    case 'tool_result':
      return mapToolResult(entry.toolUseId ?? '', entry.text, entry.isError === true, entry.images ?? []);
    case 'error':
      return { type: 'error', text: entry.text };
  }
}

export function migrateLegacyEntries(entries: LegacyTranscriptEntry[]): ChatEntry[] {
  const timed = entries.flatMap((entry, index) => {
    const event = migrateLegacyEntry(entry);
    return event ? [{ at: entry.at, id: `legacy-${index}`, event }] : [];
  });
  return createChatEntries(timed);
}
