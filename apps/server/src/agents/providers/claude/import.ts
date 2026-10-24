import type { ChatEntry, ChatEvent } from '@shinsa/core';
import { createChatEntries, type TimedEvent } from '../../transcripts/legacy.ts';
import type { ImageStore } from '../types.ts';
import { mapClaudePrompt, mapClaudeResult, mapClaudeTool } from './map.ts';

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
  const timed: TimedEvent[] = [];
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
  return createChatEntries(timed);
}
