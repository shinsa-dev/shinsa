import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ExtensionsSnapshot, McpServerSummary } from '@shinsa/core';
import type { ModelSource } from '../../src/agents/index.ts';
import { resolveClaudeExtensions } from '../../src/agents/providers/claude/extensions.ts';
import type { AgentSessionInput } from '../../src/agents/providers/index.ts';
import { inspectRepo } from '../../src/git/index.ts';
import { type Shinsa, startShinsa } from '../../src/serve.ts';
import { serializeClaudeToolUse, writeFile, writeSkill } from '../extensions/fixtures.ts';
import { createGitRepo, createTempDir, createTestConfig, until } from '../helpers/index.ts';
import { type FakeMcpHttp, startFakeMcpHttp } from '../helpers/mcp/http.ts';

setDefaultTimeout(30_000);

const STDIO_SERVER = resolve(import.meta.dirname, '../helpers/mcp/stdio-server.ts');

const models = { listModels: () => Promise.resolve([]) } as unknown as ModelSource;

const running: { shinsa: Shinsa[]; fakes: FakeMcpHttp[] } = { shinsa: [], fakes: [] };

afterEach(async () => {
  for (const shinsa of running.shinsa.splice(0)) await shinsa.stop();
  for (const fake of running.fakes.splice(0)) await fake.stop();
});

function createMachine(open: FakeMcpHttp, guarded: FakeMcpHttp) {
  const userHome = createTempDir();
  const claudeDir = join(userHome, '.claude');
  const pluginRoot = join(claudeDir, 'plugins', 'cache', 'market', 'docs', '1.0.0');
  const files = {
    claudeConfig: join(userHome, '.claude.json'),
    codexConfig: join(userHome, '.codex', 'config.toml'),
    settings: join(claudeDir, 'settings.json'),
  };
  writeFile(
    files.claudeConfig,
    JSON.stringify({
      mcpServers: {
        echo: { command: process.execPath, args: [STDIO_SERVER], env: { FAKE_MCP_GREETING: 'hi' } },
      },
    })
  );
  writeFile(files.codexConfig, `[mcp_servers.lookup]\nurl = "${open.mcpUrl}"\n`);
  writeFile(files.settings, JSON.stringify({ enabledPlugins: { 'docs@market': true } }));
  writeFile(
    join(claudeDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ plugins: { 'docs@market': [{ installPath: pluginRoot }] } })
  );
  writeFile(
    join(pluginRoot, '.mcp.json'),
    JSON.stringify({ mcpServers: { remote_docs: { type: 'http', url: guarded.mcpUrl } } })
  );
  writeSkill(join(pluginRoot, 'skills'), 'lookup-docs', 'Looks up library docs.');
  writeSkill(join(claudeDir, 'skills'), 'animate', 'Builds an animation.');
  const before = Object.fromEntries(
    Object.entries(files).map(([key, path]) => [key, readFileSync(path, 'utf8')])
  );
  return { userHome, claudeDir, files, before };
}

async function post(shinsa: Shinsa, path: string, body: unknown) {
  const response = await fetch(`${shinsa.url}/api/extensions${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: shinsa.url },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function findServer(snapshot: unknown, name: string): McpServerSummary {
  const server = (snapshot as ExtensionsSnapshot).servers.find((entry) => entry.name === name);
  if (!server) throw new Error(`No server named ${name}`);
  return server;
}

describe('MCP servers and skills, end to end', () => {
  test('finds what you set up, checks it over stdio and HTTP, signs in inside Shinsa and hands it all to the agent', async () => {
    const open = startFakeMcpHttp({ tools: [{ name: 'search', description: 'Searches the docs.' }] });
    const guarded = startFakeMcpHttp({ oauth: true });
    running.fakes.push(open, guarded);
    const machine = createMachine(open, guarded);
    const repo = await createGitRepo({ remote: false });
    const sessions: AgentSessionInput[] = [];
    const home = createTempDir();
    const shinsa = await startShinsa(
      createTestConfig(home, { roots: [repo.root], userHome: machine.userHome }),
      {
        models,
        resolveLogin: () => Promise.resolve(null),
        extensions: { env: { HOME: machine.userHome } },
        startSession: (input) => {
          sessions.push(input);
          const signal = new AbortController().signal;
          const done = (async () => {
            await input.tools.handle('answer', { answer: 'Done.' }, signal, 1);
            return { outcome: 'completed' as const, summary: null };
          })();
          return { done, steer: () => false, cancel: () => done.then(() => undefined) };
        },
      }
    );
    running.shinsa.push(shinsa);

    const listed = (await (await fetch(`${shinsa.url}/api/extensions`)).json()) as ExtensionsSnapshot;
    expect(listed.servers.map((server) => [server.name, server.source, server.enabled])).toEqual([
      ['echo', 'claude', true],
      ['lookup', 'codex', true],
      ['remote_docs', 'plugin', true],
    ]);
    expect(listed.skills.map((skill) => [skill.name, skill.enabled])).toEqual([
      ['evidence', true],
      ['handover', true],
      ['review', true],
      ['animate', true],
      ['lookup-docs', true],
    ]);
    expect(listed.plugins.map((plugin) => [plugin.id, plugin.enabled, plugin.servers])).toEqual([
      ['docs@market', true, 1],
    ]);

    const checked = await post(shinsa, '/check', {});
    expect(checked.status).toBe(200);
    expect(findServer(checked.body, 'echo').status).toMatchObject({
      state: 'connected',
      tools: [{ name: 'echo' }, { name: 'refuse' }, { name: 'silent' }, { name: 'picture' }],
    });
    expect(findServer(checked.body, 'echo').status.tokens).toBeGreaterThan(0);
    expect(findServer(checked.body, 'lookup').status).toMatchObject({
      state: 'connected',
      tools: [{ name: 'search' }],
    });
    expect(findServer(checked.body, 'remote_docs').status.state).toBe('needs_sign_in');

    const started = await post(shinsa, '/servers/sign-in', {
      serverId: 'plugin:docs@market:remote_docs',
    });
    const authorizationUrl = String(started.body.authorizationUrl);
    expect(authorizationUrl.startsWith(`${guarded.url}/authorize`)).toBe(true);
    const redirect = await fetch(authorizationUrl, { redirect: 'manual' });
    const callback = redirect.headers.get('location') ?? '';
    expect(callback.startsWith(`${shinsa.url}/api/mcp/oauth/callback?`)).toBe(true);
    const page = await fetch(callback);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Signed in to remote_docs');
    const signedIn = findServer(await (await fetch(`${shinsa.url}/api/extensions`)).json(), 'remote_docs');
    expect(signedIn).toMatchObject({ signedIn: true, status: { state: 'connected' } });
    const secretsPath = join(home, 'data', 'secrets.json');
    expect(statSync(secretsPath).mode & 0o777).toBe(0o600);
    expect(readFileSync(secretsPath, 'utf8')).toContain('access-1');
    expect(readFileSync(join(home, 'extensions.json'), 'utf8')).not.toContain('access-1');

    const added = await post(shinsa, '/servers/add', {
      server: { name: 'notes', transport: 'stdio', command: process.execPath, args: [STDIO_SERVER, 'notes'] },
    });
    expect(findServer(added.body, 'notes')).toMatchObject({
      source: 'shinsa',
      enabled: true,
      editable: true,
    });
    const refused = await post(shinsa, '/servers/add', {
      server: { name: 'bad name', transport: 'stdio', command: 'x' },
    });
    expect(refused.status).toBe(400);
    expect(refused.body).toMatchObject({ error: { code: 'server_name_invalid' } });
    await post(shinsa, '/servers/choose', { serverId: 'claude:echo', enabled: false });
    await post(shinsa, '/skills/choose', { skillId: 'user:animate', enabled: false });
    await post(shinsa, '/optimizer', { enabled: false });

    const candidate = await inspectRepo(repo.path);
    await shinsa.engine.dispatch({
      type: 'repo.register',
      repo: { ...candidate, checkCommands: [] },
      projectName: null,
    });
    const [repoId = ''] = Object.keys(shinsa.engine.state.repos);
    await shinsa.engine.dispatch({ type: 'task.create', request: 'What is open?', repoId, mode: 'ask' });
    await until('the agent to start', () => sessions.length === 1);
    const given = sessions[0]?.extensions;
    expect(given?.servers.map((server) => [server.name, server.claudeName])).toEqual([
      ['notes', 'notes'],
      ['lookup', 'lookup'],
      ['plugin_docs_remote_docs', 'plugin:docs:remote_docs'],
    ]);
    expect(given?.servers.at(-1)?.definition.headers.Authorization).toBe('Bearer access-1');
    expect(given?.skillsOff).toEqual(['animate']);
    expect(given?.plugins).toEqual({ 'docs@market': true });
    expect(given?.loaded.servers.find((server) => server.name === 'lookup')?.tokens).toBeGreaterThan(0);

    const signedOut = await post(shinsa, '/servers/sign-out', {
      serverId: 'plugin:docs@market:remote_docs',
    });
    expect(findServer(signedOut.body, 'remote_docs').signedIn).toBe(false);
    const pluginOff = await post(shinsa, '/plugins/choose', {
      pluginId: 'docs@market',
      enabled: false,
    });
    expect((pluginOff.body as unknown as ExtensionsSnapshot).plugins[0]?.enabled).toBe(false);
    expect((await post(shinsa, '/servers/remove', { serverId: 'shinsa:notes' })).status).toBe(200);
    const copied = await post(shinsa, '/servers/update', {
      serverId: 'codex:lookup',
      server: { transport: 'http', url: open.mcpUrl, headers: { 'X-Team': 'docs' } },
    });
    expect(findServer(copied.body, 'lookup')).toMatchObject({
      id: 'shinsa:lookup',
      editable: true,
      headerKeys: ['X-Team'],
    });

    for (const [key, path] of Object.entries(machine.files)) {
      expect(readFileSync(path, 'utf8')).toBe(machine.before[key] ?? '');
    }
  });
});

const DAY = 86_400_000;

function createOptimizerMachine() {
  const userHome = createTempDir();
  const claudeDir = join(userHome, '.claude');
  const echo = { command: process.execPath, args: [STDIO_SERVER], env: { FAKE_MCP_GREETING: 'from echo' } };
  const daily = { command: process.execPath, args: [STDIO_SERVER, 'daily'] };
  writeFile(
    join(userHome, '.claude.json'),
    JSON.stringify({
      mcpServers: { echo, daily },
      projects: { '/code/elsewhere': { mcpServers: { echo } } },
    })
  );
  writeFile(
    join(userHome, '.codex', 'config.toml'),
    `[mcp_servers.echo]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(STDIO_SERVER)}]\n`
  );
  const now = Date.now();
  writeFile(
    join(claudeDir, 'projects', '-code-app', 'session.jsonl'),
    [
      serializeClaudeToolUse('mcp__daily__echo', now - DAY),
      serializeClaudeToolUse('mcp__echo__echo', now - 40 * DAY),
      '',
    ].join('\n')
  );
  return { userHome };
}

interface ScriptedTurn {
  input: AgentSessionInput;
  call: (name: string, input: Record<string, unknown>) => Promise<string>;
  finish: () => void;
}

function startScriptedAgents(hotLoad: boolean) {
  const turns: ScriptedTurn[] = [];
  const startSession = (input: AgentSessionInput) => {
    const finished = Promise.withResolvers<void>();
    const signal = new AbortController().signal;
    let calls = 0;
    turns.push({
      input,
      call: (name, args) => {
        calls += 1;
        input.onEntry({
          type: 'tool_call',
          callId: `c${calls}`,
          tool: { kind: 'mcp', server: 'shinsa', name, args },
        });
        return input.tools.handle(name, args, signal, calls);
      },
      finish: () => finished.resolve(),
    });
    const done = (async () => {
      await finished.promise;
      await input.tools.handle('answer', { answer: 'Done.' }, signal, 'answer');
      return { outcome: 'completed' as const, summary: null };
    })();
    return {
      done,
      steer: () => false,
      cancel: () => done.then(() => undefined),
      ...(hotLoad
        ? {
            loadMcpServers: (servers: { claudeName: string }[]) =>
              Promise.resolve(Object.fromEntries(servers.map((server) => [server.claudeName, null]))),
          }
        : {}),
    };
  };
  return { turns, startSession };
}

async function finishTurn(shinsa: Shinsa, turn: ScriptedTurn | undefined) {
  turn?.finish();
  await until('the run to end', () =>
    Object.values(shinsa.engine.state.runs).every((run) => run.endedAt !== null)
  );
}

async function listAgentTools(input: AgentSessionInput) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'agent', version: '1.0.0' });
  await input.tools.createServer().connect(serverSide);
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools.map((tool) => tool.name);
}

async function startTask(shinsa: Shinsa, root: string, request = 'What is open?') {
  const candidate = await inspectRepo(root);
  if (Object.keys(shinsa.engine.state.repos).length === 0) {
    await shinsa.engine.dispatch({
      type: 'repo.register',
      repo: { ...candidate, checkCommands: [] },
      projectName: null,
    });
  }
  const [repoId = ''] = Object.keys(shinsa.engine.state.repos);
  await shinsa.engine.dispatch({ type: 'task.create', request, repoId, mode: 'ask' });
}

async function readExtensions(shinsa: Shinsa) {
  return (await (await fetch(`${shinsa.url}/api/extensions`)).json()) as ExtensionsSnapshot;
}

async function startOptimizedShinsa(hotLoad: boolean) {
  const machine = createOptimizerMachine();
  const repo = await createGitRepo({ remote: false });
  const agents = startScriptedAgents(hotLoad);
  const config = createTestConfig(createTempDir(), { roots: [repo.root], userHome: machine.userHome });
  const shinsa = await startShinsa(config, {
    models,
    resolveLogin: () => Promise.resolve(null),
    extensions: { env: { HOME: machine.userHome } },
    startSession: agents.startSession,
  });
  running.shinsa.push(shinsa);
  const usageRead = () =>
    until('the sessions to be read', () => existsSync(join(config.dataDir, 'extension-usage.json')));
  return { shinsa, repo, agents, usageRead };
}

describe('the context optimizer, end to end', () => {
  test('one server defined in Claude Code, a project and Codex is one row, checked once and loaded once', async () => {
    const { shinsa, repo, agents } = await startOptimizedShinsa(false);
    await post(shinsa, '/optimizer', { enabled: false });
    const listed = await readExtensions(shinsa);
    const echo = listed.servers.filter((server) => server.name === 'echo');
    expect(echo).toHaveLength(1);
    expect(echo[0]?.definedIn.map((place) => [place.source, place.origin])).toEqual([
      ['claude', '~/.claude.json'],
      ['claude_project', '~/.claude.json · /code/elsewhere'],
      ['codex', '~/.codex/config.toml'],
    ]);
    const checked = await post(shinsa, '/check', {});
    expect(findServer(checked.body, 'echo').status.state).toBe('connected');
    await post(shinsa, '/servers/choose', { serverId: 'codex:echo', enabled: false });
    expect(
      findServer(
        (await post(shinsa, '/servers/choose', { serverId: 'claude:echo', enabled: true })).body,
        'echo'
      ).enabled
    ).toBe(true);
    await startTask(shinsa, repo.path);
    await until('the agent to start', () => agents.turns.length === 1);
    const given = agents.turns[0]?.input.extensions;
    expect(given?.servers.filter((server) => server.name === 'echo')).toHaveLength(1);
    expect(given?.codexServersOff).toEqual([]);
    await finishTurn(shinsa, agents.turns[0]);
  });

  test('leaves out a server agents have not used in its window, and the agent loads it through Shinsa when it needs it', async () => {
    const { shinsa, repo, agents, usageRead } = await startOptimizedShinsa(false);
    await usageRead();
    await post(shinsa, '/check', {});
    const chosen = await post(shinsa, '/optimizer', { enabled: true, days: 14 });
    expect((chosen.body as unknown as ExtensionsSnapshot).optimizer).toEqual({
      enabled: true,
      days: 14,
      skills: true,
    });
    expect(findServer(chosen.body, 'echo')).toMatchObject({ deferred: true });
    expect(findServer(chosen.body, 'daily')).toMatchObject({ deferred: false });
    expect((await post(shinsa, '/optimizer', { days: 0 })).status).toBe(400);

    await startTask(shinsa, repo.path);
    await until('the agent to start', () => agents.turns.length === 1);
    const turn = agents.turns[0] as ScriptedTurn;
    expect(turn.input.extensions?.servers.map((server) => server.name)).toEqual(['daily']);
    expect(turn.input.extensions?.loaded.deferred).toEqual([{ name: 'echo', tokens: expect.any(Number) }]);
    expect(await listAgentTools(turn.input)).toEqual(
      expect.arrayContaining(['load_mcp_server', 'call_mcp_tool'])
    );

    const loaded = await turn.call('load_mcp_server', { name: 'echo' });
    expect(loaded).toStartWith('Connected to echo through Shinsa.');
    expect(await turn.call('call_mcp_tool', { server: 'echo', tool: 'echo', arguments: {} })).toBe(
      'from echo'
    );
    await finishTurn(shinsa, turn);
  });

  test('starts on, and an agent finds and uses a left-out server the human names loosely', async () => {
    const { shinsa, repo, agents, usageRead } = await startOptimizedShinsa(false);
    await usageRead();
    await post(shinsa, '/check', {});
    const listed = await readExtensions(shinsa);
    expect(listed.optimizer).toEqual({ enabled: true, days: 14, skills: true });
    expect(findServer(listed, 'echo')).toMatchObject({ deferred: true });

    await startTask(shinsa, repo.path, 'Ask the Echo MCP what is open.');
    await until('the agent to start', () => agents.turns.length === 1);
    const turn = agents.turns[0] as ScriptedTurn;
    expect(turn.input.prompt).toContain('Ask the Echo MCP what is open.');
    expect(turn.input.extensions?.servers.map((server) => server.name)).toEqual(['daily']);
    const instructions = resolveClaudeExtensions(turn.input.extensions).instructions ?? '';
    expect(instructions).toContain('- MCP servers: echo (4 tools). Load one with `load_mcp_server`.');
    expect(instructions).toContain('When the human names a server or a skill you do not have');

    expect(await turn.call('load_mcp_server', { name: 'the Echo MCP' })).toStartWith(
      'Connected to echo through Shinsa.'
    );
    expect(await turn.call('call_mcp_tool', { server: 'Echo', tool: 'echo', arguments: {} })).toBe(
      'from echo'
    );
    await finishTurn(shinsa, turn);
  });

  test('a session that can take a server mid-run gets it straight away', async () => {
    const { shinsa, repo, agents, usageRead } = await startOptimizedShinsa(true);
    await usageRead();
    await post(shinsa, '/optimizer', { enabled: true });
    await startTask(shinsa, repo.path);
    await until('the agent to start', () => agents.turns.length === 1);
    const turn = agents.turns[0] as ScriptedTurn;
    expect(await turn.call('load_mcp_server', { name: 'echo' })).toStartWith(
      'Loaded echo. Its tools are available to you now as mcp__echo__<tool>.'
    );
    await finishTurn(shinsa, turn);
  });
});
