import { describe, expect, test } from 'bun:test';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { KNOWN_AGENT_MODELS } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { resolveModels } from '../../../../src/agents/providers/claude/models/families.ts';
import { CATALOG_TIMEOUT_MS } from '../../../../src/agents/providers/claude/models/schema.ts';
import { makeModelCatalog } from '../../../../src/agents/providers/claude/models/service.ts';
import type { ClaudeRuntime } from '../../../../src/agents/providers/claude/sdk/schema.ts';
import { createFakeQuery, createFakeRuntime } from '../../../helpers/query.ts';

function createCatalog(runtime: ClaudeRuntime, timeoutMs = CATALOG_TIMEOUT_MS) {
  const catalog = Effect.runSync(makeModelCatalog({ runtime, timeout: Duration.millis(timeoutMs) }));
  return { list: () => Effect.runPromise(catalog.list) };
}

const ROWS = [
  { value: 'default', displayName: 'Default', description: 'Recommended' },
  { value: 'opus', resolvedModel: 'claude-opus-4-8', displayName: 'Opus', description: 'Most capable' },
  { value: 'claude-opus-4-8', displayName: 'Opus again', description: 'duplicate' },
  { value: 'haiku', displayName: 'Haiku', description: 'Fast' },
] as ModelInfo[];

function createCatalogQuery(supportedModels: () => Promise<unknown[]>) {
  return createFakeQuery(
    (params) => {
      void (params.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]().next();
      return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) };
    },
    { supportedModels }
  );
}

describe('resolveModels', () => {
  test('keeps one model per family and skips the default alias', () => {
    expect(resolveModels(ROWS).map((model) => model.id)).toEqual(['opus', 'haiku']);
  });
});

describe('the model catalog', () => {
  test('asks the SDK once and keeps the answer', async () => {
    let asked = 0;
    const fake = createCatalogQuery(() => {
      asked += 1;
      return Promise.resolve(ROWS);
    });
    const catalog = createCatalog(createFakeRuntime(fake.query));
    expect((await catalog.list()).map((model) => model.id)).toEqual(['opus', 'haiku']);
    await catalog.list();
    expect(asked).toBe(1);
  });

  test('falls back to the built-in list, and asks again next time', async () => {
    let asked = 0;
    const empty = createCatalogQuery(() => {
      asked += 1;
      return Promise.resolve(asked === 1 ? [] : Promise.reject(new Error('no claude')));
    });
    const catalog = createCatalog(createFakeRuntime(empty.query));
    expect(await catalog.list()).toEqual(KNOWN_AGENT_MODELS);
    expect(await catalog.list()).toEqual(KNOWN_AGENT_MODELS);
    expect(asked).toBe(2);
  });

  test('a catalog that takes too long is abandoned for the built-in list', async () => {
    let aborted: AbortSignal | undefined;
    const slow = createFakeQuery(
      (params) => {
        aborted = params.options?.abortController?.signal;
        return {
          [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }),
          signal: aborted,
        };
      },
      {
        supportedModels: () =>
          new Promise((_resolve, reject) => {
            aborted?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      }
    );
    expect(await createCatalog(createFakeRuntime(slow.query), 5).list()).toEqual(KNOWN_AGENT_MODELS);
  });
});
