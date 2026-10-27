import { describe, expect, spyOn, test } from 'bun:test';
import { KNOWN_CODEX_MODELS } from '@shinsa/core';
import { CodexModelCatalog, resolveCodexModels } from '../../../../src/agents/providers/codex/models.ts';
import { log } from '../../../../src/log/index.ts';
import { FakeCodex } from '../../../helpers/codex.ts';

describe('the Codex model list', () => {
  test('comes from model/list, without hidden models, across pages, and is asked once', async () => {
    const codex = new FakeCodex({
      modelPages: true,
      models: [
        { id: 'gpt-6-astra', model: 'gpt-6-astra', displayName: 'GPT-6-Astra', description: 'Frontier' },
        { id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', displayName: '', description: 'Fast' },
      ],
    });
    const catalog = new CodexModelCatalog(codex.runtime);
    expect(await catalog.list()).toEqual([
      { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: 'Frontier' },
      { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: 'Fast' },
    ]);
    await catalog.list();
    expect(codex.requests('model/list')).toEqual([{}, { cursor: 'next' }]);
  });

  test('rows that are not models are skipped', () => {
    expect(resolveCodexModels([null, 'x', { hidden: true, model: 'internal' }, { id: 'only-id' }])).toEqual([
      { id: 'only-id', label: 'Only-id', description: '' },
    ]);
  });

  test('falls back to the built-in list when Codex cannot answer, and asks again next time', async () => {
    const warn = spyOn(log, 'warn');
    const empty = new CodexModelCatalog(new FakeCodex({ models: [] }).runtime);
    expect(await empty.list()).toEqual(KNOWN_CODEX_MODELS);
    const missing = new CodexModelCatalog({
      resolveExecutable: () =>
        Promise.resolve({ ok: false, reason: 'not_installed', message: 'No codex.', version: null }),
    });
    expect(await missing.list()).toEqual(KNOWN_CODEX_MODELS);
    const slow = new CodexModelCatalog(new FakeCodex().runtime, 1);
    expect(await slow.list()).toEqual(KNOWN_CODEX_MODELS);
    expect(warn.mock.calls.map(([message]) => message)).toContain(
      '[Models] Falling back to the built-in Codex list'
    );
    warn.mockRestore();
  });
});
