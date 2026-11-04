import { describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KNOWN_CODEX_MODELS } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import type { CodexExecutable } from '../../../../src/agents/providers/codex/executable.ts';
import { CODEX_CAPABILITIES, CodexCli } from '../../../../src/agents/providers/codex/index.ts';
import type { AgentSessionInput } from '../../../../src/agents/providers/types.ts';
import { ProgramVersions } from '../../../../src/agents/providers/versions/service.ts';
import { ShellLayer } from '../../../../src/shell/layers.ts';
import { FakeCodex } from '../../../helpers/codex.ts';
import { createTempDir } from '../../../helpers/index.ts';
import { captureLogs } from '../../../helpers/logs.ts';
import { buildCodexProvider, runProvider, startProviderSession } from '../../../helpers/providers.ts';
import { createTestTools } from '../../../helpers/tools.ts';

function createInput(patch: Partial<AgentSessionInput> = {}): AgentSessionInput {
  return {
    role: 'answerer',
    readOnly: true,
    cwd: createTempDir(),
    prompt: 'Where is it?',
    model: null,
    resume: null,
    defaultBranch: 'main',
    tools: createTestTools('answerer', () => Promise.resolve('Answered.')),
    pluginDir: '/plugin',
    onSession: () => undefined,
    onEntry: () => undefined,
    ...patch,
  };
}

describe('the Codex provider', () => {
  test('declares what Codex can do: resume, steer, approve, read-only, handoff, structured output, compaction and fast mode', async () => {
    const provider = buildCodexProvider(new FakeCodex().runtime);
    expect(provider).toMatchObject({ id: 'codex', label: 'Codex', capabilities: CODEX_CAPABILITIES });
    expect(CODEX_CAPABILITIES).toMatchObject({
      sessions: { resume: true, inspect: false, fork: true },
      turns: { steering: true },
      approvals: true,
      planning: { readOnly: true },
      contextHandoff: true,
      structuredOutput: true,
      accounts: false,
      compaction: true,
      folds: false,
      fastMode: true,
    });
    expect(provider.compactSession).toBeInstanceOf(Function);
    const installed = await Effect.runPromise(
      CodexCli.use((cli) => cli.resolveExecutable).pipe(
        Effect.provide(CodexCli.layer.pipe(Layer.provide(ProgramVersions.layer), Layer.provide(ShellLayer)))
      )
    );
    expect(installed).toMatchObject({ ok: true, version: '0.200.0' });
    expect(provider.inspectSession).toBeUndefined();
  });

  test('wires sessions, models, calls, sign-in and usage to the codex it runs', async () => {
    const outdated: CodexExecutable = {
      ok: false,
      reason: 'outdated',
      message: 'Codex 0.1.0 is older than Shinsa needs.',
      version: '0.1.0',
    };
    let resolved = 0;
    const resolveExecutable = Effect.sync(() => {
      resolved += 1;
      return outdated;
    });
    const provider = buildCodexProvider(
      { resolveExecutable },
      { usage: { env: { CODEX_HOME: createTempDir() } } }
    );
    const logs = captureLogs();
    expect(await startProviderSession(provider, createInput()).done).toMatchObject({
      outcome: 'failed',
      summary: outdated.message,
    });
    expect(
      await startProviderSession(
        { ...provider, startSession: provider.compactSession! },
        createInput({ role: 'agent', readOnly: false })
      ).done
    ).toMatchObject({
      outcome: 'failed',
      summary: outdated.message,
    });
    expect(await runProvider(provider.listModels)).toEqual(KNOWN_CODEX_MODELS);
    logs.restore();
    expect(logs.fieldsOf('[Models] Falling back to the built-in Codex list')).toEqual([
      { error: outdated.message },
    ]);
    await expect(runProvider(provider.complete({ system: 's', prompt: 'p', model: 'm' }))).rejects.toThrow(
      outdated.message
    );
    await expect(
      runProvider(
        provider.completeStructured!({
          system: 's',
          prompt: 'p',
          model: 'm',
          schema: { type: 'object', properties: {} },
        })
      )
    ).rejects.toThrow(outdated.message);
    expect(await runProvider(provider.readLogin!)).toMatchObject({
      status: 'outdated',
      version: '0.1.0',
      detail: outdated.message,
    });
    expect(await runProvider(provider.readUsage!)).toMatchObject({
      read: { ok: false, reason: 'failed', detail: outdated.message },
    });
    expect(resolved).toBe(7);
  });

  test('a session without a model leaves the choice to Codex', async () => {
    const codex = new FakeCodex();
    const provider = buildCodexProvider(codex.runtime, { heartbeatMs: 5 });
    const session = startProviderSession(provider, createInput());
    expect((await session.done).outcome).toBe('completed');
    expect(session.steer('too late')).toBe(false);
    expect(codex.requests('thread/start')[0]).not.toHaveProperty('model');
  });

  test('a codex that will not start reads as signed out, and usage is read over HTTP with the stored sign-in and says when it cannot reach Codex', async () => {
    const home = createTempDir();
    writeFileSync(join(home, 'auth.json'), JSON.stringify({ tokens: { access_token: 'access-1' } }));
    const asked: string[] = [];
    const provider = buildCodexProvider(
      {
        resolveExecutable: Effect.succeed({
          ok: true,
          path: join(home, 'missing-codex'),
          version: '0.200.0',
        }),
      },
      {
        usage: {
          env: { CODEX_HOME: home },
          requestHttp: (url) => {
            asked.push(url);
            return Promise.reject(new Error('offline'));
          },
        },
      }
    );
    expect(await runProvider(provider.readLogin!)).toMatchObject({ status: 'signed_out' });
    expect(await runProvider(provider.readUsage!)).toMatchObject({
      read: { ok: false, reason: 'failed', detail: 'Could not reach Codex: offline' },
    });
    expect(asked).toHaveLength(1);
  });
});
