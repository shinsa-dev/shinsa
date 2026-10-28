import { describe, expect, mock, spyOn, test } from 'bun:test';
import { KNOWN_CODEX_MODELS } from '@shinsa/core';
import type { CodexExecutable } from '../../../../src/agents/providers/codex/executable.ts';
import { CODEX_CAPABILITIES, createCodexProvider } from '../../../../src/agents/providers/codex/index.ts';
import { CODEX_RUNTIME } from '../../../../src/agents/providers/codex/session.ts';
import type { AgentSessionInput } from '../../../../src/agents/providers/types.ts';
import { createShinsaTools } from '../../../../src/agents/tools/index.ts';
import { log } from '../../../../src/log/index.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { createTempDir } from '../../../helpers/index.ts';

function createInput(patch: Partial<AgentSessionInput> = {}): AgentSessionInput {
  return {
    role: 'answerer',
    readOnly: true,
    cwd: createTempDir(),
    prompt: 'Where is it?',
    model: null,
    resume: null,
    defaultBranch: 'main',
    tools: createShinsaTools('answerer', () => Promise.resolve('Answered.')),
    pluginDir: '/plugin',
    onSession: () => undefined,
    onEntry: () => undefined,
    ...patch,
  };
}

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

  test('wires sessions, models, calls, sign-in and usage to the codex it runs', async () => {
    const outdated: CodexExecutable = {
      ok: false,
      reason: 'outdated',
      message: 'Codex 0.1.0 is older than Shinsa needs.',
      version: '0.1.0',
    };
    const resolveExecutable = mock(() => Promise.resolve(outdated));
    const provider = createCodexProvider({ resolveExecutable }, {}, { env: { CODEX_HOME: createTempDir() } });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    expect(await provider.startSession(createInput()).done).toMatchObject({
      outcome: 'failed',
      summary: outdated.message,
    });
    expect(
      await provider.compactSession?.(createInput({ role: 'agent', readOnly: false })).done
    ).toMatchObject({
      outcome: 'failed',
      summary: outdated.message,
    });
    expect(await provider.listModels()).toEqual(KNOWN_CODEX_MODELS);
    expect(warn.mock.calls[0]?.[1]).toEqual({ error: outdated.message });
    warn.mockRestore();
    await expect(provider.complete({ system: 's', prompt: 'p', model: 'm' })).rejects.toThrow(
      outdated.message
    );
    await expect(
      provider.completeStructured?.({
        system: 's',
        prompt: 'p',
        model: 'm',
        schema: { type: 'object', properties: {} },
      })
    ).rejects.toThrow(outdated.message);
    expect(await provider.readLogin?.()).toMatchObject({
      status: 'outdated',
      version: '0.1.0',
      detail: outdated.message,
    });
    expect(await provider.readUsage?.()).toMatchObject({
      read: { ok: false, reason: 'failed', detail: outdated.message },
    });
    expect(resolveExecutable).toHaveBeenCalledTimes(7);
  });

  test('a session without a model leaves the choice to Codex', async () => {
    const codex = new FakeCodex();
    const provider = createCodexProvider(codex.runtime, { heartbeatMs: 5 });
    expect((await provider.startSession(createInput()).done).outcome).toBe('completed');
    expect(codex.requests('thread/start')[0]).not.toHaveProperty('model');
  });
});
