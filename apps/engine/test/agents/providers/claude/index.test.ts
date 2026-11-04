import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Effect } from 'effect';
import { resolveClaudeProjectName } from '../../../../src/agents/providers/claude/artifacts.ts';
import { CLAUDE_CAPABILITIES } from '../../../../src/agents/providers/claude/index.ts';
import { createTempDir } from '../../../helpers/index.ts';
import { buildClaudeProvider, runProvider, startScopedSession } from '../../../helpers/providers.ts';
import { createFakeQuery, createFakeRuntime, emit } from '../../../helpers/query.ts';
import { createTestTools } from '../../../helpers/tools.ts';

describe('the Claude provider', () => {
  test('starts sessions, completes, lists models and converts sessions through the SDK', async () => {
    const fake = createFakeQuery(
      (params) => {
        if (typeof params.prompt === 'string') {
          if (params.options?.outputFormat)
            return emit({ type: 'result', subtype: 'success', structured_output: { ok: true } });
          return emit({ type: 'result', subtype: 'success', result: 'pong' });
        }
        return emit(
          { type: 'system', subtype: 'init', session_id: 'sess-9' },
          { type: 'result', subtype: 'success', result: 'Done.', is_error: false }
        ) as AsyncIterable<SDKMessage>;
      },
      { supportedModels: () => Promise.resolve([{ value: 'opus', displayName: 'Opus', description: '' }]) }
    );
    const provider = buildClaudeProvider(createFakeRuntime(fake.query));
    expect(provider).toMatchObject({ id: 'claude', label: 'Claude', capabilities: CLAUDE_CAPABILITIES });
    expect(await runProvider(provider.complete({ system: 's', prompt: 'ping', model: 'haiku' }))).toBe(
      'pong'
    );
    expect(
      await runProvider(
        provider.completeStructured!({
          system: 's',
          prompt: 'ping',
          model: 'haiku',
          schema: { type: 'object', properties: {} },
        })
      )
    ).toEqual({ ok: true });
    expect((await runProvider(provider.listModels)).map((model) => model.id)).toEqual(['opus']);
    const sessions: string[] = [];
    const session = startScopedSession(
      provider.startSession({
        role: 'agent',
        readOnly: false,
        cwd: '/work',
        prompt: 'Build it',
        model: null,
        resume: null,
        defaultBranch: 'main',
        tools: createTestTools('agent', () => Promise.resolve('ok')),
        pluginDir: '/plugin',
        onSession: (id) => sessions.push(id),
        onEntry: () => undefined,
      })
    );
    expect(await session.done).toMatchObject({ outcome: 'completed', summary: 'Done.', failure: null });
    expect(sessions).toEqual(['sess-9']);
    expect(session.steer('too late')).toBe(false);
  });

  test('compacts a session by resuming it with the CLI’s compact command', async () => {
    const prompts: string[] = [];
    const fake = createFakeQuery((params) => {
      void (async () => {
        for await (const prompt of params.prompt as AsyncIterable<{ message: { content: string } }>) {
          prompts.push(prompt.message.content);
        }
      })();
      return emit({
        type: 'result',
        subtype: 'success',
        result: '',
        is_error: false,
      }) as AsyncIterable<SDKMessage>;
    });
    const provider = buildClaudeProvider(createFakeRuntime(fake.query));
    expect(provider.capabilities?.compaction).toBe(true);
    const session = startScopedSession(
      provider.compactSession!({
        role: 'agent',
        readOnly: false,
        cwd: '/work',
        model: null,
        resume: 'sess-1',
        defaultBranch: 'main',
        tools: createTestTools('agent', () => Promise.resolve('ok')),
        pluginDir: '/plugin',
        onSession: () => undefined,
        onEntry: () => undefined,
      })
    );
    await session.done;
    expect(prompts).toEqual(['/compact']);
    expect(fake.calls[0]?.options?.resume).toBe('sess-1');
  });

  test('checks a session file in the Claude home it was given', async () => {
    const home = createTempDir();
    const cwd = '/work/app';
    const project = join(home, '.claude', 'projects', resolveClaudeProjectName(cwd));
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'sess-1.jsonl'), `${JSON.stringify({ type: 'user' })}\n`);
    const provider = buildClaudeProvider(createFakeRuntime(createFakeQuery(() => emit()).query), {
      env: {},
      home,
    });
    expect(await runProvider(provider.inspectSession!({ cwd, sessionId: 'sess-1' }))).toBe('present');
    expect(await runProvider(provider.inspectSession!({ cwd, sessionId: 'sess-2' }))).toBe('missing');
  });

  test('a call that fails comes back as ProviderCallFailed naming Claude', async () => {
    const broken = createFakeQuery(() => {
      throw new Error('no claude here');
    });
    const provider = buildClaudeProvider(createFakeRuntime(broken.query));
    const failure = await runProvider(
      Effect.flip(provider.complete({ system: 's', prompt: 'ping', model: 'haiku' }))
    );
    expect(failure).toMatchObject({ _tag: 'ProviderCallFailed', provider: 'claude' });
    expect(failure.message).toContain('no claude here');
  });
});
