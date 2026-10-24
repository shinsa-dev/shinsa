import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { RunUsage } from '@shinsa/core';

export function resolveClaudeUsage(message: SDKResultMessage): RunUsage | null {
  const models = Object.values(message.modelUsage ?? {});
  const usage: RunUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: Number.isFinite(message.total_cost_usd) ? message.total_cost_usd : null,
  };
  for (const model of models) {
    usage.inputTokens += model.inputTokens;
    usage.outputTokens += model.outputTokens;
    usage.cacheReadTokens += model.cacheReadInputTokens;
    usage.cacheWriteTokens += model.cacheCreationInputTokens;
  }
  const tokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  return tokens > 0 ? usage : null;
}
