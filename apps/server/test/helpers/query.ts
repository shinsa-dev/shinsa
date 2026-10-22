import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn } from '../../src/agents/claude/index.ts';

export type QueryParams = Parameters<QueryFn>[0];

export interface FakeQueryControls {
  interrupt?: () => Promise<void>;
  close?: () => void;
  supportedModels?: () => Promise<unknown[]>;
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
    } as unknown as Query;
  }) as QueryFn;
  return { query, calls };
}

export async function* emit(...messages: unknown[]): AsyncGenerator<SDKMessage> {
  for (const message of messages) yield sdkMessage(message);
}
