import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeExecutable } from '../../src/agents/providers/claude/executable.ts';
import type { ClaudeRuntime, QueryFn } from '../../src/agents/providers/claude/sdk.ts';

export type QueryParams = Parameters<QueryFn>[0];

export interface FakeQueryControls {
  interrupt?: () => Promise<void>;
  close?: () => void;
  supportedModels?: () => Promise<unknown[]>;
  getContextUsage?: () => Promise<unknown>;
  accountInfo?: () => Promise<unknown>;
  setMcpServers?: (servers: Record<string, unknown>) => Promise<unknown>;
}

export function sdkMessage(value: unknown) {
  return value as SDKMessage;
}

export function createFakeQuery(
  produce: (params: QueryParams) => AsyncIterable<SDKMessage>,
  controls: FakeQueryControls = {}
) {
  const calls: QueryParams[] = [];
  const query = ((params: QueryParams) => {
    calls.push(params);
    const iterator = produce(params)[Symbol.asyncIterator]();
    return {
      [Symbol.asyncIterator]: () => iterator,
      next: () => iterator.next(),
      interrupt: controls.interrupt ?? (() => Promise.resolve()),
      close: controls.close ?? (() => undefined),
      supportedModels: controls.supportedModels ?? (() => Promise.resolve([])),
      ...(controls.getContextUsage ? { getContextUsage: controls.getContextUsage } : {}),
      ...(controls.accountInfo ? { accountInfo: controls.accountInfo } : {}),
      ...(controls.setMcpServers ? { setMcpServers: controls.setMcpServers } : {}),
    } as unknown as Query;
  }) as QueryFn;
  return { query, calls };
}

export function createFakeRuntime(
  query: QueryFn,
  executable: ClaudeExecutable = { ok: true, path: '/bin/claude', version: null }
): ClaudeRuntime {
  return { runQuery: query, resolveExecutable: () => Promise.resolve(executable) };
}

export async function* emit(...messages: unknown[]): AsyncGenerator<SDKMessage> {
  for (const message of messages) yield sdkMessage(message);
}
