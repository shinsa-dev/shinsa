import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent } from '@shinsa/core';
import { type ImageStore, mapClaudeResult, mapClaudeTool } from './map.ts';

interface AssistantBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export function createClaudeRecorder(onEntry: (event: ChatEvent) => void, storeImage?: ImageStore) {
  let pending: string | null = null;
  const flush = (phase: 'interim' | 'final') => {
    if (pending === null) return;
    onEntry({ type: 'agent', phase, text: pending });
    pending = null;
  };
  const recordBlock = (block: AssistantBlock) => {
    if (block.type === 'text' && block.text?.trim()) {
      flush('interim');
      pending = block.text;
    }
    if (block.type === 'tool_use') {
      flush('interim');
      onEntry({
        type: 'tool_call',
        callId: block.id ?? '',
        tool: mapClaudeTool(block.name ?? '', block.input),
      });
    }
  };
  const record = (message: SDKMessage) => {
    if (message.type === 'result') flush('final');
    if (message.type === 'assistant' && message.parent_tool_use_id === null) {
      for (const block of message.message.content) recordBlock(block);
    }
    if (message.type !== 'user' || message.parent_tool_use_id !== null) return;
    if (typeof message.message.content === 'string') return;
    for (const block of message.message.content) {
      if (block.type === 'tool_result') onEntry(mapClaudeResult(block, storeImage));
    }
  };
  return { record, flush };
}
