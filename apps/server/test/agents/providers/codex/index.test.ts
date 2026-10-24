import { describe, expect, test } from 'bun:test';
import { CODEX_CAPABILITIES, createCodexProvider } from '../../../../src/agents/providers/codex/index.ts';
import { CODEX_RUNTIME } from '../../../../src/agents/providers/codex/session.ts';
import { createShinsaTools } from '../../../../src/agents/tools/index.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { createTempDir } from '../../../helpers/index.ts';

describe('the Codex provider', () => {
  test('declares what Codex can do: resume, steer, approve, read-only, handoff, structured output, compaction and fast mode', async () => {
    const provider = createCodexProvider();
    expect(provider).toMatchObject({ id: 'codex', label: 'Codex', capabilities: CODEX_CAPABILITIES });
    expect(CODEX_CAPABILITIES).toMatchObject({
      sessions: { resume: true, inspect: false },
      turns: { steering: true },
      approvals: true,
      planning: { readOnly: true },
      contextHandoff: true,
      structuredOutput: true,
      accounts: false,
      compaction: true,
      fastMode: true,
    });
    expect(provider.compactSession).toBeInstanceOf(Function);
    expect(await CODEX_RUNTIME.resolveExecutable()).toMatchObject({ ok: true, version: '0.200.0' });
    expect(provider.inspectSession).toBeUndefined();
  });

  test('wires sessions, models, calls, sign-in and imports to the codex it runs', async () => {
    const codex = new FakeCodex({ quick: '{"ok": true}' });
    const provider = createCodexProvider(
      codex.runtime,
      { heartbeatMs: 5, compactGraceMs: 5 },
      { env: { ...codex.env, CODEX_HOME: createTempDir() } }
    );
    const session = provider.startSession({
      role: 'answerer',
      cwd: createTempDir(),
      prompt: 'Where is it?',
      model: null,
      resume: null,
      defaultBranch: 'main',
      tools: createShinsaTools('answerer', () => Promise.resolve('Answered.')),
      pluginDir: '/plugin',
      onSession: () => undefined,
      onEntry: () => undefined,
    });
    expect((await session.done).outcome).toBe('completed');
    expect(codex.requests('thread/start')[0]).not.toHaveProperty('model');
    expect((await provider.listModels()).map((model) => model.id)).toEqual(['gpt-6-astra']);
    expect(await provider.complete({ system: 's', prompt: 'p', model: 'm' })).toBe('{"ok": true}');
    expect(
      await provider.completeStructured?.({
        system: 's',
        prompt: 'p',
        model: 'm',
        schema: { type: 'object', properties: {} },
      })
    ).toEqual({ ok: true });
    expect(await provider.readLogin?.()).toMatchObject({ status: 'signed_in' });
    expect(await provider.readUsage?.()).toMatchObject({ email: 'codex@example.com', plan: 'plus' });
    const compaction = provider.compactSession?.({
      role: 'builder',
      cwd: createTempDir(),
      model: null,
      resume: codex.read().threads[0] ?? null,
      defaultBranch: 'main',
      tools: createShinsaTools('builder', () => Promise.resolve('No.')),
      pluginDir: '/plugin',
      onSession: () => undefined,
      onEntry: () => undefined,
    });
    expect((await compaction?.done)?.outcome).toBe('completed');
    expect(codex.requests('thread/compact/start')).toHaveLength(1);
  });
});
