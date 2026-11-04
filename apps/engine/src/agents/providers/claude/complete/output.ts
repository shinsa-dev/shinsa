import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { STRUCTURED_OUTPUT_TOOL } from './schema.ts';

export function readStructuredOutput(message: SDKMessage): unknown {
  if (message.type === 'result')
    return message.subtype === 'success' ? (message.structured_output ?? null) : null;
  if (message.type !== 'assistant') return null;
  for (const block of message.message.content) {
    if (block.type === 'tool_use' && block.name === STRUCTURED_OUTPUT_TOOL) return block.input ?? null;
  }
  return null;
}

export function readCompletionText(message: SDKMessage) {
  return message.type === 'result' && message.subtype === 'success' ? message.result.trim() : null;
}
