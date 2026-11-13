import { CHAT_PROTOCOL_VERSION, type ChatEntry, type ChatEvent, markFinalReplies } from '@shinsa/core';
import { Option, Schema } from 'effect';
import type { ImageStore } from '../types.ts';
import { mapClaudePrompt, mapClaudeResult, mapClaudeTool } from './map.ts';
import { SessionContentBlock, type SessionLine, SessionLineText } from './schema.ts';

const decodeSessionLine = Schema.decodeUnknownOption(SessionLineText);

const decodeContentBlock = Schema.decodeUnknownOption(SessionContentBlock);

interface TimedEvent {
  at: number;
  id: string;
  event: ChatEvent;
}

function createChatEntries(timed: TimedEvent[]): ChatEntry[] {
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
  block: SessionContentBlock,
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

export function convertClaudeSession(text: string, now: number, storeImage?: ImageStore): ChatEntry[] {
  const timed: TimedEvent[] = [];
  text.split('\n').forEach((raw, lineIndex) => {
    if (!raw.trim()) return;
    const decoded = decodeSessionLine(raw);
    if (Option.isNone(decoded)) return;
    const line = decoded.value;
    if (line.isSidechain || line.isMeta || !line.message) return;
    const at = line.timestamp ? Date.parse(line.timestamp) : now;
    const base = line.uuid ?? `line-${lineIndex}`;
    const content = line.message.content;
    if (line.type === 'user' && typeof content === 'string') {
      const event = mapClaudePrompt(content, 'you');
      if (event) timed.push({ at, id: base, event });
      return;
    }
    if (!Array.isArray(content)) return;
    content.forEach((value, blockIndex) => {
      const block = decodeContentBlock(value);
      const event = Option.isSome(block) ? mapBlock(line, block.value, storeImage) : null;
      if (event) timed.push({ at, id: `${base}-${blockIndex}`, event });
    });
  });
  return createChatEntries(timed);
}
