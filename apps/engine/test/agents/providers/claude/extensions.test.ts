import { describe, expect, spyOn, test } from 'bun:test';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { AsyncQueue } from '../../../../src/agents/providers/claude/async-queue.ts';
import { resolveClaudeExtensions } from '../../../../src/agents/providers/claude/extensions.ts';
import { startClaudeSession } from '../../../../src/agents/providers/claude/session.ts';
import type { AgentSessionInput } from '../../../../src/agents/providers/index.ts';

type ChatEntryEvent = Parameters<AgentSessionInput['onEntry']>[0];

import { createShinsaTools } from '../../../../src/agents/tools/index.ts';
import type { McpDefinition } from '../../../../src/extensions/definitions.ts';
import type { SessionExtensions } from '../../../../src/extensions/index.ts';
import { log } from '../../../../src/log/index.ts';
import { until } from '../../../helpers/index.ts';
import { createFakeQuery, createFakeRuntime, sdkMessage } from '../../../helpers/query.ts';

function definition(overrides: Partial<McpDefinition>): McpDefinition {
  return {
    transport: 'stdio',
    command: null,
    args: [],
    env: {},
    cwd: null,
    url: null,
    headers: {},
    bearerTokenEnv: null,
    ...overrides,
  };
}

const EXTENSIONS: SessionExtensions = {
  servers: [
    {
      name: 'files',
      claudeName: 'files',
      definition: definition({ command: 'npx', args: ['files'], env: { ROOT: '/x' } }),
    },
    {
      name: 'docs',
      claudeName: 'docs',
      definition: definition({
        transport: 'http',
        url: 'https://docs.dev/mcp',
        headers: { Authorization: 'Bearer t' },
      }),
    },
    {
      name: 'plugin_feed_feed',
      claudeName: 'plugin:feed:feed',
      definition: definition({ transport: 'sse', url: 'https://feed.dev/sse' }),
    },
  ],
  skills: [
    {
      name: 'review',
      description: 'Reviews.',
      path: '/plugin/skills/review/SKILL.md',
      claudeName: 'shinsa:review',
      source: 'shinsa',
    },
    {
      name: 'lookup',
      description: 'Looks up docs.',
      path: '/p/lookup/SKILL.md',
      claudeName: 'docs:lookup',
      source: 'plugin',
    },
    {
      name: 'release',
      description: '',
      path: '/codex/skills/release/SKILL.md',
      claudeName: null,
      source: 'codex',
    },
  ],
  plugins: { 'figma@market': false, 'docs@market': true },
  skillsOff: ['animate'],
  codexServersOff: [],
  deferred: [],
  deferredSkills: [],
  loaded: {
    servers: [{ name: 'files', tokens: 1200 }],
    skills: [{ name: 'shinsa:review', tokens: 30 }],
    plugins: [{ name: 'docs', tokens: 80 }],
  },
};

describe('what a Claude agent is given', () => {
  test('without settings, only Shinsa’s own skills and no other server or plugin change', () => {
    expect(resolveClaudeExtensions(undefined)).toEqual({
      skills: ['shinsa:handover', 'shinsa:review', 'shinsa:evidence'],
      skillOverrides: {},
      enabledPlugins: {},
      servers: {},
      instructions: null,
    });
  });

  test('the enabled servers, every skill but the ones turned off, each plugin as switched, and Codex skills as files to read', () => {
    const resolved = resolveClaudeExtensions(EXTENSIONS);
    expect(resolved.skills).toBe('all');
    expect(resolved.skillOverrides).toEqual({ animate: 'off' });
    expect(resolved.enabledPlugins).toEqual({ 'figma@market': false, 'docs@market': true });
    expect(resolved.servers).toEqual({
      files: { type: 'stdio', command: 'npx', args: ['files'], env: { ROOT: '/x' } },
      docs: { type: 'http', url: 'https://docs.dev/mcp', headers: { Authorization: 'Bearer t' } },
      'plugin:feed:feed': { type: 'sse', url: 'https://feed.dev/sse', headers: {} },
    });
    expect(resolved.instructions).toBe(
      '## More skills\nRead these files with a shell command when they apply:\n- `/codex/skills/release/SKILL.md`: release'
    );
    expect(resolveClaudeExtensions({ ...EXTENSIONS, skills: [] }).instructions).toBeNull();
    const leftOut = resolveClaudeExtensions({
      ...EXTENSIONS,
      skills: [],
      deferred: [
        {
          name: 'maple',
          claudeName: 'maple',
          definition: definition({ url: 'https://maple.dev/mcp' }),
          tools: ['query_data'],
          tokens: 4000,
        },
      ],
    }).instructions;
    expect(leftOut).toStartWith('## Left out until needed');
    expect(leftOut).toContain('- MCP servers: maple (1 tool). Load one with `load_mcp_server`.');
    expect(leftOut).toContain('When the human names a server or a skill you do not have');
    expect(
      resolveClaudeExtensions({
        ...EXTENSIONS,
        servers: [{ name: 'x', claudeName: 'x', definition: definition({}) }],
      }).servers.x
    ).toMatchObject({ command: '' });
    expect(
      resolveClaudeExtensions({
        ...EXTENSIONS,
        servers: [{ name: 'y', claudeName: 'y', definition: definition({ transport: 'http' }) }],
      }).servers.y
    ).toMatchObject({ url: '' });
  });
});

function createInput(extensions?: SessionExtensions): AgentSessionInput {
  return {
    role: 'agent',
    readOnly: false,
    cwd: '/work',
    prompt: 'Build it',
    model: null,
    resume: null,
    defaultBranch: 'main',
    tools: createShinsaTools('agent', () => Promise.resolve('ok')),
    pluginDir: '/plugin',
    onSession: () => undefined,
    onEntry: () => undefined,
    ...(extensions ? { extensions } : {}),
  };
}

function startScripted(
  input: AgentSessionInput,
  setMcpServers?: (servers: Record<string, unknown>) => Promise<unknown>
) {
  const messages = new AsyncQueue<SDKMessage>();
  const prompts: SDKUserMessage[] = [];
  const fake = createFakeQuery(
    (params) => {
      void (async () => {
        for await (const prompt of params.prompt as AsyncIterable<SDKUserMessage>) {
          prompts.push(prompt);
          messages.push(sdkMessage({ type: 'result', subtype: 'success', result: 'done', is_error: false }));
        }
        messages.close();
      })();
      return messages;
    },
    setMcpServers ? { setMcpServers } : {}
  );
  const session = startClaudeSession(input, {
    runtime: createFakeRuntime(fake.query),
    contextTimeoutMs: 10,
    now: () => 1_000,
  });
  return { session, prompts, calls: fake.calls };
}

describe('a Claude session with MCP servers and skills', () => {
  test('loads nothing from the user’s MCP config, filters skills, says what it loaded, and hands credentials over stdin before the brief', async () => {
    const order: string[] = [];
    const handed: Record<string, unknown>[] = [];
    const entries: ChatEntryEvent[] = [];
    const run = startScripted(
      { ...createInput(EXTENSIONS), onEntry: (entry) => entries.push(entry) },
      (servers) => {
        order.push('servers');
        handed.push(servers);
        return Promise.resolve({ added: Object.keys(servers), removed: [], errors: {} });
      }
    );
    await until('the brief reaches the agent', () => run.prompts.length === 1);
    order.push('brief');
    expect(order).toEqual(['servers', 'brief']);
    const options = run.calls[0]?.options ?? {};
    expect(options.strictMcpConfig).toBe(true);
    expect(options.skills).toBe('all');
    expect(options.settings).toMatchObject({
      enabledPlugins: { 'figma@market': false, 'docs@market': true },
      skillOverrides: { animate: 'off' },
    });
    expect(entries[1]).toEqual({ type: 'notice', notice: { kind: 'extensions', ...EXTENSIONS.loaded } });
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['shinsa']);
    expect(JSON.stringify({ ...options, mcpServers: null, hooks: null })).not.toContain('Bearer t');
    expect(Object.keys(handed[0] ?? {})).toEqual(['shinsa', 'files', 'docs', 'plugin:feed:feed']);
    const append = (options.systemPrompt as { append: string }).append;
    expect(append).toContain('/codex/skills/release/SKILL.md');
    await run.session.done;
  });

  test('a resumed session whose set did not change says nothing about it', async () => {
    const entries: ChatEntryEvent[] = [];
    const run = startScripted(
      { ...createInput(EXTENSIONS), announceExtensions: false, onEntry: (entry) => entries.push(entry) },
      (servers) => Promise.resolve({ added: Object.keys(servers), removed: [], errors: {} })
    );
    await until('the brief reaches the agent', () => run.prompts.length === 1);
    expect(entries.some((entry) => entry.type === 'notice' && entry.notice.kind === 'extensions')).toBe(
      false
    );
    await run.session.done;
  });

  test('a server that does not connect is logged and the agent still starts', async () => {
    const warn = spyOn(log, 'warn');
    const run = startScripted(createInput(EXTENSIONS), () =>
      Promise.resolve({ added: [], removed: [], errors: { docs: 'refused' } })
    );
    await until('the brief reaches the agent', () => run.prompts.length === 1);
    expect(warn).toHaveBeenCalledWith('[Claude] An MCP server did not connect', {
      server: 'docs',
      error: 'refused',
    });
    warn.mockRestore();
    await run.session.done;
  });

  test('a CLI that cannot take the servers still gets the brief', async () => {
    const warn = spyOn(log, 'warn');
    const run = startScripted(createInput(EXTENSIONS), () => Promise.reject(new Error('unsupported')));
    await until('the brief reaches the agent', () => run.prompts.length === 1);
    expect(warn).toHaveBeenCalledWith('[Claude] Could not hand the MCP servers to the session', {
      error: 'unsupported',
    });
    warn.mockRestore();
    await run.session.done;
  });

  test('with no servers to add, the brief goes straight in and only Shinsa’s skills load', async () => {
    const run = startScripted(createInput());
    await until('the brief reaches the agent', () => run.prompts.length === 1);
    const options = run.calls[0]?.options ?? {};
    expect(options.strictMcpConfig).toBe(true);
    expect(options.skills).toEqual(['shinsa:handover', 'shinsa:review', 'shinsa:evidence']);
    expect((options.settings as { skillOverrides?: unknown }).skillOverrides).toBeUndefined();
    await run.session.done;
  });
});

describe('loading a server into a running Claude session', () => {
  test('adds it to the servers the session already has, reports each one’s error, and drops one that failed or was given up on', async () => {
    const messages = new AsyncQueue<SDKMessage>();
    const release = Promise.withResolvers<void>();
    const handed: Record<string, unknown>[] = [];
    const fake = createFakeQuery(
      (params) => {
        void (async () => {
          for await (const _prompt of params.prompt as AsyncIterable<SDKUserMessage>) {
            await release.promise;
            messages.push(
              sdkMessage({ type: 'result', subtype: 'success', result: 'done', is_error: false })
            );
          }
          messages.close();
        })();
        return messages;
      },
      {
        setMcpServers: (servers) => {
          handed.push({ ...servers });
          if ('broken' in servers) return Promise.reject(new Error('The session did not answer.'));
          return Promise.resolve({ added: [], removed: [], errors: { 'plugin:docs:context': 'refused' } });
        },
      }
    );
    const session = startClaudeSession(createInput(EXTENSIONS), {
      runtime: createFakeRuntime(fake.query),
      contextTimeoutMs: 10,
      now: () => 1_000,
    });
    await until('the servers are handed over', () => handed.length === 1);
    const deferred = (name: string, claudeName: string) => ({
      name,
      claudeName,
      definition: definition({ transport: 'http', url: `https://${name}.dev/mcp` }),
      tools: [],
      tokens: null,
    });
    const kept = new AbortController().signal;
    expect(
      await session.loadMcpServers?.(
        [deferred('maple', 'maple'), deferred('plugin_docs_context', 'plugin:docs:context')],
        kept
      )
    ).toEqual({ maple: null, 'plugin:docs:context': 'refused' });
    expect(Object.keys(handed[1] ?? {})).toEqual([
      'shinsa',
      'files',
      'docs',
      'plugin:feed:feed',
      'maple',
      'plugin:docs:context',
    ]);
    await session.loadMcpServers?.([deferred('slow', 'slow')], AbortSignal.abort());
    await expect(session.loadMcpServers?.([deferred('broken', 'broken')], kept)).rejects.toThrow(
      'The session did not answer.'
    );
    await session.loadMcpServers?.([deferred('linear', 'linear')], kept);
    expect(Object.keys(handed.at(-1) ?? {})).toEqual([
      'shinsa',
      'files',
      'docs',
      'plugin:feed:feed',
      'maple',
      'linear',
    ]);
    release.resolve();
    await session.done;
    await expect(
      session.loadMcpServers?.([deferred('late', 'late')], kept) ?? Promise.resolve()
    ).rejects.toThrow('The session has ended.');
  });
});
