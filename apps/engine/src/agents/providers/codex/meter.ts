import type { RunUsage } from '@shinsa/core';
import type { UsageBaseline } from '../types.ts';
import { type CodexTokens, LONG_CONTEXT_INPUT_TOKENS, resolveCodexCost } from './pricing.ts';

type Params = Record<string, unknown>;

interface ThreadMeter {
  previous: CodexTokens;
  usage: RunUsage;
}

interface MeteredThread {
  sessionId: string;
  usage: RunUsage;
}

const EMPTY: CodexTokens = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 };

function readCount(record: Params, key: string) {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function readCodexTokens(breakdown: Params): CodexTokens {
  const cached = readCount(breakdown, 'cachedInputTokens');
  const written = readCount(breakdown, 'cacheWriteInputTokens');
  return {
    inputTokens: Math.max(0, readCount(breakdown, 'inputTokens') - cached - written),
    cacheReadTokens: cached,
    cacheWriteTokens: written,
    outputTokens: readCount(breakdown, 'outputTokens'),
  };
}

function subtract(current: CodexTokens, previous: CodexTokens): CodexTokens {
  return {
    inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
    cacheReadTokens: Math.max(0, current.cacheReadTokens - previous.cacheReadTokens),
    cacheWriteTokens: Math.max(0, current.cacheWriteTokens - previous.cacheWriteTokens),
    outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
  };
}

function countTokens(tokens: CodexTokens) {
  return tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens;
}

function createUsage(): RunUsage {
  return { ...EMPTY, costUsd: 0 };
}

export function createCodexMeter(baseline: UsageBaseline = () => null) {
  const threads = new Map<string, ThreadMeter>();

  const selectThread = (threadId: string): ThreadMeter => {
    const known = threads.get(threadId);
    if (known) return known;
    const recorded = baseline(threadId);
    const thread = recorded
      ? { previous: { ...EMPTY, ...recorded }, usage: { ...recorded } }
      : { previous: EMPTY, usage: createUsage() };
    threads.set(threadId, thread);
    return thread;
  };

  const record = (threadId: string, tokenUsage: Params, model: string | null, fast: boolean) => {
    const total = tokenUsage.total;
    if (!total || typeof total !== 'object') return;
    const thread = selectThread(threadId);
    const current = readCodexTokens(total as Params);
    const delta = subtract(current, thread.previous);
    thread.previous = current;
    if (countTokens(delta) === 0) return;
    const last = tokenUsage.last && typeof tokenUsage.last === 'object' ? (tokenUsage.last as Params) : {};
    const longContext = readCount(last, 'inputTokens') > LONG_CONTEXT_INPUT_TOKENS;
    const cost = resolveCodexCost(model, delta, { longContext, fast });
    const usage = thread.usage;
    thread.usage = {
      inputTokens: usage.inputTokens + delta.inputTokens,
      cacheReadTokens: usage.cacheReadTokens + delta.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens + delta.cacheWriteTokens,
      outputTokens: usage.outputTokens + delta.outputTokens,
      costUsd: usage.costUsd === null || cost === null ? null : usage.costUsd + cost,
    };
  };

  const usage = (threadId: string): RunUsage | null => {
    const recorded = threads.get(threadId)?.usage;
    return recorded && countTokens(recorded) > 0 ? recorded : null;
  };

  const listOthers = (threadId: string | null): MeteredThread[] =>
    [...threads.keys()].flatMap((sessionId) => {
      const recorded = sessionId === threadId ? null : usage(sessionId);
      return recorded ? [{ sessionId, usage: recorded }] : [];
    });

  return { record, usage, listOthers };
}
