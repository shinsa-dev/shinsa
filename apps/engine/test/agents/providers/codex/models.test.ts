import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { KNOWN_CODEX_MODELS } from '@shinsa/core';
import { Duration, Effect } from 'effect';
import { TestClock } from 'effect/testing';
import { resolveCodexModels } from '../../../../src/agents/providers/codex/models/rows.ts';
import { CATALOG_TIMEOUT_MS } from '../../../../src/agents/providers/codex/models/schema.ts';
import { makeCodexModelCatalog } from '../../../../src/agents/providers/codex/models/service.ts';
import type { CodexRuntime } from '../../../../src/agents/providers/codex/session/schema.ts';
import { MODEL_CATALOG_TTL } from '../../../../src/agents/providers/schema.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { captureLogs } from '../../../helpers/logs.ts';
import { runProvider } from '../../../helpers/providers.ts';

function makeCatalog(runtime: CodexRuntime, timeoutMs = CATALOG_TIMEOUT_MS) {
  return makeCodexModelCatalog({
    executable: runtime.resolveExecutable,
    env: runtime.env,
    cwd: tmpdir(),
    timeout: Duration.millis(timeoutMs),
    timeToLive: MODEL_CATALOG_TTL,
  });
}

function createCatalog(runtime: CodexRuntime, timeoutMs = CATALOG_TIMEOUT_MS) {
  const catalog = Effect.runSync(makeCatalog(runtime, timeoutMs));
  return { list: () => runProvider(catalog.list) };
}

describe('the Codex model list', () => {
  test('comes from model/list, without hidden models, across pages, and is asked once', async () => {
    const codex = new FakeCodex({
      modelPages: true,
      models: [
        { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Frontier' },
        { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: '', description: 'Fast' },
      ],
    });
    const catalog = createCatalog(codex.runtime);
    expect(await catalog.list()).toEqual([
      { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Fast' },
    ]);
    await catalog.list();
    expect(codex.requests('model/list')).toEqual([{}, { cursor: 'next' }]);
  });

  test('asks again once the list is older than its time to live', async () => {
    const codex = new FakeCodex({
      models: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: '' }],
    });
    await Effect.gen(function* () {
      const catalog = yield* makeCatalog(codex.runtime);
      yield* catalog.list;
      yield* catalog.list;
      expect(codex.requests('model/list')).toHaveLength(1);
      yield* TestClock.adjust(MODEL_CATALOG_TTL);
      yield* catalog.list;
      expect(codex.requests('model/list')).toHaveLength(2);
    }).pipe(Effect.scoped, Effect.provide(TestClock.layer()), runProvider);
  });

  test('keeps the last list it had when a later ask fails', async () => {
    const codex = new FakeCodex({
      models: [{ id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: '' }],
    });
    let installed = true;
    const runtime: CodexRuntime = {
      ...codex.runtime,
      resolveExecutable: Effect.suspend(() =>
        installed
          ? codex.runtime.resolveExecutable
          : Effect.succeed({
              ok: false as const,
              reason: 'not_installed' as const,
              message: 'No codex.',
              version: null,
            })
      ),
    };
    const catalog = createCatalog(runtime);
    const first = await catalog.list();
    expect(first.map((model) => model.id)).toEqual(['gpt-6-astra']);
    installed = false;
    expect(await catalog.list()).toEqual(first);
  });

  test('rows that are not models are skipped', () => {
    expect(resolveCodexModels([null, 'x', { hidden: true, model: 'internal' }, { id: 'only-id' }])).toEqual([
      { id: 'only-id', label: 'Only-id', description: '' },
    ]);
  });

  test('falls back to the built-in list when Codex cannot answer, and asks again next time', async () => {
    const logs = captureLogs();
    const empty = createCatalog(new FakeCodex({ models: [] }).runtime);
    expect(await empty.list()).toEqual(KNOWN_CODEX_MODELS);
    const missing = createCatalog({
      resolveExecutable: Effect.succeed({
        ok: false as const,
        reason: 'not_installed' as const,
        message: 'No codex.',
        version: null,
      }),
    });
    expect(await missing.list()).toEqual(KNOWN_CODEX_MODELS);
    const slow = createCatalog(new FakeCodex().runtime, 1);
    expect(await slow.list()).toEqual(KNOWN_CODEX_MODELS);
    logs.restore();
    expect(logs.fieldsOf('[Models] Falling back to the built-in Codex list')).toHaveLength(3);
  });
});
