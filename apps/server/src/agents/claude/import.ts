import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent, markFinalReplies } from '@shinsa/core';
import {
  type ImageStore,
  mapClaudePrompt,
  mapClaudeResult,
  mapClaudeTool,
  mapLegacyClaudeTool,
  mapToolResult,
} from './map.ts';

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface SessionLine {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: string | ContentBlock[] };
}

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

interface Timed {
  at: number;
  id: string;
  event: ChatEvent;
}

function stamp(timed: Timed[]): ChatEntry[] {
  const events = markFinalReplies(timed.map((item) => item.event));
  return timed.map((item, index) => ({
    ...(events[index] ?? item.event),
    v: CHAT_PROTOCOL_VERSION,
    id: item.id,
    at: item.at,
  }));
}

function mapBlock(
  line: SessionLine,
  block: ContentBlock,
  storeImage: ImageStore | undefined
): ChatEvent | null {
  if (line.type === 'assistant' && block.type === 'text' && block.text?.trim())
    return { type: 'agent', phase: 'interim', text: block.text };
  if (line.type === 'assistant' && block.type === 'tool_use')
    return { type: 'tool_call', callId: block.id ?? '', tool: mapClaudeTool(block.name ?? '', block.input) };
  if (line.type === 'user' && block.type === 'tool_result') return mapClaudeResult(block, storeImage);
  if (line.type === 'user' && block.type === 'text') return mapClaudePrompt(block.text ?? '', 'you');
  return null;
}

export function convertClaudeSession(text: string, storeImage?: ImageStore): ChatEntry[] {
  const timed: Timed[] = [];
  text.split('\n').forEach((raw, lineIndex) => {
    if (!raw.trim()) return;
    let line: SessionLine;
    try {
      line = JSON.parse(raw) as SessionLine;
    } catch {
      return;
    }
    if (line.isSidechain || line.isMeta || !line.message) return;
    const at = line.timestamp ? Date.parse(line.timestamp) : Date.now();
    const base = line.uuid ?? `line-${lineIndex}`;
    const content = line.message.content;
    if (line.type === 'user' && typeof content === 'string') {
      const event = mapClaudePrompt(content, 'you');
      if (event) timed.push({ at, id: base, event });
      return;
    }
    if (!Array.isArray(content)) return;
    content.forEach((block, blockIndex) => {
      const event = mapBlock(line, block, storeImage);
      if (event) timed.push({ at, id: `${base}-${blockIndex}`, event });
    });
  });
  return stamp(timed);
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
  return stamp(timed);
}
