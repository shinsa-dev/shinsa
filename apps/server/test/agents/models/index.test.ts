import { describe, expect, test } from 'bun:test';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import { KNOWN_AGENT_MODELS } from '@shinsa/core';
import { ModelCatalog, resolveModels } from '../../../src/agents/models/index.ts';
import { createFakeQuery } from '../../helpers/query.ts';

const ROWS = [
  { value: 'default', displayName: 'Default', description: 'Recommended' },
  { value: 'opus', resolvedModel: 'claude-opus-4-8', displayName: 'Opus', description: 'Most capable' },
  { value: 'claude-opus-4-8', displayName: 'Opus again', description: 'duplicate' },
  { value: 'haiku', displayName: 'Haiku', description: 'Fast' },
] as ModelInfo[];

function createCatalogQuery(supportedModels: () => Promise<unknown[]>) {
  return createFakeQuery(
    (params) => {
      (params.prompt as AsyncIterable<unknown>)[Symbol.asyncIterator]().next();
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

describe('ModelCatalog', () => {
  test('asks the SDK once and keeps the answer', async () => {
    let asked = 0;
    const fake = createCatalogQuery(() => {
      asked += 1;
      return Promise.resolve(ROWS);
    });
    const catalog = new ModelCatalog(fake.query);
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
    const catalog = new ModelCatalog(empty.query);
    expect(await catalog.list()).toEqual(KNOWN_AGENT_MODELS);
    expect(await catalog.list()).toEqual(KNOWN_AGENT_MODELS);
    expect(asked).toBe(2);
  });

  test('a catalog that takes too long is abandoned for the built-in list', async () => {
    const slow = createFakeQuery(
      (params) => {
        const signal = params.options?.abortController?.signal;
        return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }), signal };
      },
      {
        supportedModels: () =>
          new Promise((_resolve, reject) => setTimeout(() => reject(new Error('aborted')), 30)),
      }
    );
    expect(await new ModelCatalog(slow.query, 5).list()).toEqual(KNOWN_AGENT_MODELS);
  });

  test('the default catalog uses the real SDK', () => {
    expect(new ModelCatalog()).toBeInstanceOf(ModelCatalog);
  });
});
