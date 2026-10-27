import type { SDKMessage, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ChatEvent, ChatNotice } from '@shinsa/core';
import type { ImageStore } from '../types.ts';
import { mapClaudeResult, mapClaudeTool } from './map.ts';

interface AssistantBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface UsageSnapshot {
  usedTokens: number;
  maxTokens: number | null;
}

const COMPACT_SUMMARY = 'This session is being continued';

function readNumber(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}

export function resolveUsageSnapshot(usage: unknown, maxTokens: number | null): UsageSnapshot | null {
  if (!usage || typeof usage !== 'object') return null;
  const record = usage as Record<string, unknown>;
  const used =
    readNumber(record, 'input_tokens', 'inputTokens') +
    readNumber(record, 'cache_creation_input_tokens', 'cacheCreationInputTokens') +
    readNumber(record, 'cache_read_input_tokens', 'cacheReadInputTokens') +
    readNumber(record, 'output_tokens', 'outputTokens');
  return used > 0 ? { usedTokens: used, maxTokens } : null;
}

export function resolveContextWindow(modelUsage: unknown) {
  if (!modelUsage || typeof modelUsage !== 'object') return null;
  let largest: number | null = null;
  for (const value of Object.values(modelUsage as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const window = readNumber(value as Record<string, unknown>, 'contextWindow', 'context_window');
    if (window > 0) largest = Math.max(largest ?? 0, window);
  }
  return largest;
}

function readCompactSummary(content: unknown) {
  if (typeof content === 'string') return content.startsWith(COMPACT_SUMMARY) ? content : null;
  if (!Array.isArray(content)) return null;
  const first = content[0] as { type?: unknown; text?: unknown } | undefined;
  if (first?.type !== 'text' || typeof first.text !== 'string') return null;
  return first.text.startsWith(COMPACT_SUMMARY) ? first.text : null;
}

export function resolveRateLimitNotice(info: SDKRateLimitInfo): ChatNotice {
  return {
    kind: 'rate_limit',
    status: info.status,
    limit: info.rateLimitType ?? null,
    resetsAt: typeof info.resetsAt === 'number' ? info.resetsAt * 1000 : null,
    utilization: typeof info.utilization === 'number' ? info.utilization : null,
  };
}

export function createClaudeRecorder(onEntry: (event: ChatEvent) => void, storeImage?: ImageStore) {
  let pending: string | null = null;
  let lastLimit: string | null = null;
  let usage: UsageSnapshot | null = null;
  let contextWindow: number | null = null;
  const seenUsage = new Set<string>();

  const flush = (phase: 'interim' | 'final') => {
    if (pending === null) return;
    onEntry({ type: 'agent', phase, text: pending });
    pending = null;
  };
  const notify = (notice: ChatNotice) => onEntry({ type: 'notice', notice });

  const recordMain = (block: AssistantBlock) => {
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

  const recordNested = (block: AssistantBlock, parentCallId: string) => {
    if (block.type === 'text' && block.text?.trim()) {
      onEntry({ type: 'agent', phase: 'interim', text: block.text, parentCallId });
    }
    if (block.type === 'tool_use') {
      const tool = mapClaudeTool(block.name ?? '', block.input);
      onEntry({ type: 'tool_call', callId: block.id ?? '', tool, parentCallId });
    }
  };

  const recordUsage = (message: Extract<SDKMessage, { type: 'assistant' }>) => {
    const id = message.message.id ?? message.uuid;
    const snapshot = resolveUsageSnapshot(message.message.usage, contextWindow);
    if (!snapshot || seenUsage.has(id)) return;
    seenUsage.add(id);
    usage = snapshot;
  };

  const recordAssistant = (message: Extract<SDKMessage, { type: 'assistant' }>) => {
    const parent = message.parent_tool_use_id;
    if (parent === null) recordUsage(message);
    for (const block of message.message.content as AssistantBlock[]) {
      if (parent === null) recordMain(block);
      else recordNested(block, parent);
    }
  };

  const recordUser = (message: Extract<SDKMessage, { type: 'user' }>) => {
    const parent = message.parent_tool_use_id;
    const summary = parent === null ? readCompactSummary(message.message.content) : null;
    if (summary !== null) {
      notify({ kind: 'compaction', trigger: null, preTokens: null, summary });
      return;
    }
    if (typeof message.message.content === 'string') return;
    for (const block of message.message.content) {
      if (block.type !== 'tool_result') continue;
      const result = mapClaudeResult(block, storeImage);
      onEntry(parent === null ? result : ({ ...result, parentCallId: parent } as ChatEvent));
    }
  };

  const recordRateLimit = (info: SDKRateLimitInfo) => {
    const key = `${info.status}:${info.rateLimitType ?? ''}:${info.resetsAt ?? ''}`;
    if (key === lastLimit) return;
    lastLimit = key;
    notify(resolveRateLimitNotice(info));
  };

  const record = (message: SDKMessage) => {
    switch (message.type) {
      case 'assistant':
        recordAssistant(message);
        return;
      case 'user':
        recordUser(message);
        return;
      case 'result':
        flush('final');
        contextWindow = resolveContextWindow(message.modelUsage) ?? contextWindow;
        return;
      case 'rate_limit_event':
        recordRateLimit(message.rate_limit_info);
        return;
      case 'system':
        if (message.subtype !== 'compact_boundary') return;
        notify({
          kind: 'compaction',
          trigger: message.compact_metadata.trigger,
          preTokens: message.compact_metadata.pre_tokens,
          summary: null,
        });
        return;
      default:
        return;
    }
  };

  const takeUsage = () => {
    const snapshot = usage;
    usage = null;
    seenUsage.clear();
    return snapshot ? { ...snapshot, maxTokens: snapshot.maxTokens ?? contextWindow } : null;
  };

  return { record, flush, notify, takeUsage, window: () => contextWindow };
}

export type ClaudeRecorder = ReturnType<typeof createClaudeRecorder>;
