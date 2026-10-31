import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createState, type McpServerSummary, type ShinsaState } from '@shinsa/core';
import type { McpDefinition } from '../../src/extensions/definitions.ts';
import { Extensions, type ServerCheck } from '../../src/extensions/index.ts';
import { serializeSignInPage } from '../../src/extensions/sign-in.ts';
import { SecretStore } from '../../src/secrets/store.ts';
import { type FakeMcpHttp, startFakeMcpHttp } from '../helpers/mcp/http.ts';
import { createFakeMachine, type FakeMachine, writeFile } from './fixtures.ts';

const RETINA = { PLAYWRIGHT_MCP_DEVICE: 'Desktop Chrome HiDPI' };

let fake: FakeMcpHttp | null = null;

afterEach(async () => {
  await fake?.stop();
  fake = null;
});

function createWorld(machine: FakeMachine = createFakeMachine()) {
  const state: ShinsaState = createState();
  state.repos.r1 = {
    id: 'r1',
    name: 'app',
    path: machine.repo,
    defaultBranch: 'main',
    remote: null,
    projectId: 'p1',
    checkCommands: [],
  };
  state.projects.p1 = { id: 'p1', name: 'Work', color: 'blue', key: 'W', description: '', folders: [] };
  const checked: McpDefinition[] = [];
  const check: ServerCheck = (definition) => {
    checked.push(definition);
    return Promise.resolve({
      state: 'connected',
      error: null,
      tools: [{ name: 'echo', description: null }],
      tokens: 30,
    });
  };
  const secrets = new SecretStore(join(machine.shinsaHome, 'secrets.json'));
  writeFile(join(machine.shinsaHome, 'extensions.json'), JSON.stringify({ optimizer: { enabled: false } }));
  const extensions = new Extensions({
    state: () => state,
    config: { home: machine.shinsaHome, userHome: machine.userHome, pluginDir: machine.pluginDir },
    secrets,
    baseUrl: () => 'http://127.0.0.1:5180',
    env: machine.env,
    check,
    now: () => 42,
  });
  return { machine, state, extensions, checked, secrets };
}

function findServer(servers: McpServerSummary[], id: string) {
  const server = servers.find((entry) => entry.id === id);
  if (!server) throw new Error(`No ${id}`);
  return server;
}

describe('the MCP servers and skills Shinsa shows', () => {
  test('lists every source, on as the user set them up, without ever showing a secret value', () => {
    const { extensions, machine } = createWorld();
    const snapshot = extensions.snapshot();
    expect(snapshot.problems).toEqual([]);
    expect(snapshot.servers.filter((server) => !server.enabled).map((server) => server.id)).toEqual([
      'codex:kampala',
    ]);
    const linear = findServer(snapshot.servers, 'claude:linear');
    expect(linear).toMatchObject({
      name: 'linear',
      source: 'claude',
      transport: 'http',
      url: 'https://mcp.linear.example/mcp',
      headerKeys: ['X-Key'],
      editable: false,
      signedIn: false,
      shadowedBy: null,
      plugin: null,
      scope: { kind: 'everywhere' },
      status: { state: 'unchecked', error: null, checkedAt: null, tools: [], tokens: null },
    });
    expect(findServer(snapshot.servers, 'plugin:docs@market:context').plugin).toBe('docs@market');
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    expect(findServer(snapshot.servers, `project:${machine.repo}:repo_tools`).scope).toEqual({
      kind: 'repo',
      path: machine.repo,
    });
  });

  test('every skill starts on, with what its listing costs an agent', () => {
    const { extensions } = createWorld();
    const skills = extensions.snapshot().skills;
    expect(skills.map((skill) => skill.id)).toEqual([
      'shinsa:review',
      'user:animate',
      'plugin:docs@market:lookup-docs',
      'plugin:off@market:lookup-docs',
      expect.stringMatching(/^project:.*:conventions$/),
      'codex:release',
    ]);
    expect(skills.every((skill) => skill.enabled)).toBe(true);
    expect(skills[1]?.tokens).toBe(8);
  });

  test('a plugin manifest it cannot read is reported once', () => {
    const { extensions, machine } = createWorld();
    writeFile(join(machine.pluginRoot, '.claude-plugin', 'plugin.json'), '{ broken');
    const problems = extensions.snapshot().problems;
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('plugin.json');
  });

  test('every installed plugin, on as Claude Code has it, with what it brings and costs', () => {
    const { extensions, machine } = createWorld();
    const plugins = extensions.snapshot().plugins;
    expect(plugins).toEqual([
      {
        id: 'docs@market',
        name: 'docs',
        origin: machine.pluginRoot.replace(machine.userHome, '~'),
        enabled: true,
        skills: 1,
        agents: 1,
        commands: 1,
        servers: 1,
        hooks: true,
        tokens: 30,
      },
      expect.objectContaining({ id: 'off@market', name: 'off', enabled: false, tokens: 28 }),
    ]);
  });
});

describe('adding and changing servers', () => {
  test('a new server is on and used everywhere, and its secrets stay in Shinsa', () => {
    const { extensions } = createWorld();
    const snapshot = extensions.createServer({
      name: 'docs',
      transport: 'http',
      url: 'https://docs.example/mcp',
      headers: { Authorization: 'Bearer abc' },
    });
    expect(findServer(snapshot.servers, 'shinsa:docs')).toMatchObject({
      enabled: true,
      editable: true,
      scope: { kind: 'everywhere' },
      headerKeys: ['Authorization'],
      origin: 'Shinsa',
    });
    const stdio = extensions.createServer({
      name: 'files_2',
      transport: 'stdio',
      command: 'npx',
      args: ['files'],
      env: { ROOT: '/x' },
      enabled: false,
      scope: { kind: 'project', project: 'p1' },
    });
    expect(findServer(stdio.servers, 'shinsa:files_2')).toMatchObject({
      enabled: false,
      command: 'npx',
      args: ['files'],
      envKeys: ['ROOT'],
      scope: { kind: 'project', project: 'p1' },
    });
  });

  test('never shows a secret written into a server’s address or arguments, and keeps it on edit', async () => {
    const { extensions } = createWorld();
    extensions.createServer({
      name: 'keyed',
      transport: 'http',
      url: 'https://keyed.dev/mcp?api_key=k-123&team=core',
    });
    const shown = extensions.createServer({
      name: 'tokened',
      transport: 'stdio',
      command: 'tool',
      args: ['--token', 't-456', '--api-key=a-789', 'plain'],
    });
    expect(findServer(shown.servers, 'shinsa:keyed').url).toBe('https://keyed.dev/mcp?api_key=***&team=core');
    expect(findServer(shown.servers, 'shinsa:tokened').args).toEqual([
      '--token',
      '***',
      '--api-key=***',
      'plain',
    ]);
    expect(JSON.stringify(shown)).not.toMatch(/k-123|t-456|a-789/);
    extensions.updateServer('shinsa:tokened', {
      transport: 'stdio',
      command: 'tool',
      args: ['--token', '***', '--api-key=***', 'plain', '--fast'],
    });
    extensions.updateServer('shinsa:keyed', {
      transport: 'http',
      url: 'https://keyed.dev/mcp?api_key=***&team=core',
    });
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.find((server) => server.name === 'tokened')?.definition.args).toEqual([
      '--token',
      't-456',
      '--api-key=a-789',
      'plain',
      '--fast',
    ]);
    expect(session.servers.find((server) => server.name === 'keyed')?.definition.url).toBe(
      'https://keyed.dev/mcp?api_key=k-123&team=core'
    );
  });

  test('refuses a server it could not run, saying what to fix', () => {
    const { extensions, machine } = createWorld();
    const base = { name: 'docs', transport: 'http', url: 'https://docs.example/mcp' };
    expect(() => extensions.createServer('docs')).toThrow('Describe the MCP to add.');
    expect(() => extensions.createServer({ ...base, name: 'has space' })).toThrow('letters, digits');
    expect(() => extensions.createServer({ ...base, name: 'shinsa' })).toThrow('Shinsa’s own');
    expect(() => extensions.createServer({ ...base, transport: 'ws' })).toThrow('a command, HTTP or SSE');
    expect(() => extensions.createServer({ ...base, url: 'ftp://x' })).toThrow('http or https address');
    expect(() => extensions.createServer({ ...base, url: 'not a url' })).toThrow('http or https address');
    expect(() => extensions.createServer({ name: 'x', transport: 'stdio' })).toThrow(
      'the command that starts'
    );
    expect(() => extensions.createServer({ name: 'x', transport: 'stdio', command: 'a', args: 'b' })).toThrow(
      'list of text'
    );
    expect(() =>
      extensions.createServer({ name: 'x', transport: 'stdio', command: 'a', env: { A: 1 } })
    ).toThrow('The environment must map');
    expect(() => extensions.createServer({ ...base, scope: { kind: 'project', project: 'nope' } })).toThrow(
      'no project'
    );
    expect(() => extensions.createServer({ ...base, scope: { kind: 'repo', path: '/other' } })).toThrow(
      'No agent has worked there yet.'
    );
    expect(() => extensions.createServer({ ...base, scope: 'here' })).toThrow(
      'Pick all, a project or a repository.'
    );
    extensions.createServer({ ...base, scope: { kind: 'repo', path: machine.repo } });
    expect(() => extensions.createServer(base)).toThrow('An MCP named docs exists.');
  });

  test('editing keeps a secret you leave empty, and renaming moves the server', () => {
    const { extensions, secrets } = createWorld();
    extensions.createServer({
      name: 'docs',
      transport: 'http',
      url: 'https://a.dev/mcp',
      headers: { Authorization: 'Bearer abc' },
    });
    secrets.updateMcpCredentials('shinsa:docs', { tokens: { access_token: 'x', token_type: 'Bearer' } });
    const edited = extensions.updateServer('shinsa:docs', {
      name: 'docs',
      transport: 'http',
      url: 'https://b.dev/mcp',
      headers: { Authorization: '', 'X-New': 'n' },
    });
    expect(findServer(edited.servers, 'shinsa:docs').url).toBe('https://b.dev/mcp');
    const renamed = extensions.updateServer('shinsa:docs', {
      name: 'library',
      transport: 'http',
      url: 'https://b.dev/mcp',
      enabled: false,
    });
    expect(renamed.servers.some((server) => server.id === 'shinsa:docs')).toBe(false);
    expect(findServer(renamed.servers, 'shinsa:library')).toMatchObject({ enabled: false, headerKeys: [] });
    expect(() => extensions.updateServer('shinsa:library', null)).toThrow('Describe the MCP.');
    expect(() => extensions.updateServer('shinsa:none', {})).toThrow('no MCP with that id');
  });

  test('editing a server from another tool copies it into Shinsa, whose copy then leads its row', async () => {
    const { extensions } = createWorld();
    extensions.updateServerChoice('claude:linear', { enabled: true });
    const copied = extensions.updateServer('claude:linear', {
      transport: 'http',
      url: 'https://mcp.linear.example/mcp',
      headers: { 'X-Key': '' },
    });
    expect(findServer(copied.servers, 'shinsa:linear')).toMatchObject({ enabled: true, editable: true });
    expect(findServer(copied.servers, 'shinsa:linear').definedIn.map((place) => place.id)).toEqual([
      'shinsa:linear',
      'claude:linear',
    ]);
    expect(copied.servers.some((server) => server.id === 'claude:linear')).toBe(false);
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.filter((server) => server.name === 'linear')).toEqual([
      {
        name: 'linear',
        claudeName: 'linear',
        definition: expect.objectContaining({ headers: { 'X-Key': 'secret' } }),
      },
    ]);
    const moved = extensions.updateServer('shinsa:linear', {
      transport: 'http',
      url: 'https://own.linear/mcp',
    });
    expect(findServer(moved.servers, 'claude:linear').shadowedBy).toBe('shinsa:linear');
  });

  test('editing a server you turned off keeps it off', () => {
    const { extensions } = createWorld();
    extensions.updateServerChoice('claude:linear', { enabled: false });
    const edited = extensions.updateServer('claude:linear', {
      transport: 'http',
      url: 'https://mcp.linear.example/mcp',
      headers: { 'X-Key': '', 'X-Team': 'core' },
    });
    expect(findServer(edited.servers, 'shinsa:linear').enabled).toBe(false);
  });

  test('editing a Codex server that signs in from a variable keeps signing it in', async () => {
    const { extensions, machine } = createWorld();
    writeFile(
      join(machine.codexHome, 'config.toml'),
      '[mcp_servers.tracker]\nurl = "https://tracker.example/mcp"\nbearer_token_env_var = "LINEAR_TOKEN"\n'
    );
    extensions.updateServer('codex:tracker', {
      transport: 'http',
      url: 'https://tracker.example/mcp',
      headers: { 'X-Team': 'core' },
    });
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.find((server) => server.name === 'tracker')?.definition.headers).toEqual({
      'X-Team': 'core',
      Authorization: 'Bearer lin-123',
    });
  });

  test('editing a command server keeps the folder it starts in', async () => {
    const { extensions, machine } = createWorld();
    writeFile(
      join(machine.repo, '.mcp.json'),
      JSON.stringify({ mcpServers: { repo_tools: { command: 'node', args: ['tools.js'], cwd: 'tools' } } })
    );
    extensions.updateServer(`project:${machine.repo}:repo_tools`, {
      transport: 'stdio',
      command: 'node',
      args: ['tools.js', '--fast'],
    });
    const session = await extensions.resolveSession({ repoPath: machine.repo, project: null });
    expect(session.servers.find((server) => server.name === 'repo_tools')?.definition).toMatchObject({
      args: ['tools.js', '--fast'],
      cwd: 'tools',
    });
  });

  test('only Shinsa’s own servers can be removed; the others are turned off', () => {
    const { extensions } = createWorld();
    extensions.createServer({ name: 'docs', transport: 'http', url: 'https://a.dev/mcp' });
    expect(extensions.removeServer('shinsa:docs').servers.some((server) => server.id === 'shinsa:docs')).toBe(
      false
    );
    expect(() => extensions.removeServer('claude:linear')).toThrow(
      'It comes from ~/.claude/.claude.json. Turn it off.'
    );
  });

  test('turning a server on or off and choosing where it is used', () => {
    const { extensions, machine } = createWorld();
    const on = extensions.updateServerChoice('codex:maple', {
      enabled: true,
      scope: { kind: 'repo', path: machine.repo },
    });
    expect(findServer(on.servers, 'codex:maple')).toMatchObject({
      enabled: true,
      scope: { kind: 'repo', path: machine.repo },
    });
    expect(
      findServer(extensions.updateServerChoice('codex:maple', { enabled: false }).servers, 'codex:maple')
        .enabled
    ).toBe(false);
    extensions.createServer({ name: 'docs', transport: 'http', url: 'https://a.dev/mcp' });
    expect(
      findServer(extensions.updateServerChoice('shinsa:docs', { enabled: false }).servers, 'shinsa:docs')
        .enabled
    ).toBe(false);
    expect(
      findServer(
        extensions.updateServerChoice('shinsa:docs', { scope: { kind: 'project', project: 'p1' } }).servers,
        'shinsa:docs'
      )
    ).toMatchObject({ enabled: false, scope: { kind: 'project', project: 'p1' } });
    expect(() => extensions.updateServerChoice('shinsa:docs', 'on')).toThrow('Say what to change.');
  });

  test('turning a skill on or off', () => {
    const { extensions } = createWorld();
    const on = extensions.updateSkillChoice('user:animate', true);
    expect(on.skills.find((skill) => skill.id === 'user:animate')?.enabled).toBe(true);
    expect(() => extensions.updateSkillChoice('user:animate', 'yes')).toThrow('Turn the skill on or off.');
    expect(() => extensions.updateSkillChoice('user:none', true)).toThrow('no skill with that id');
  });
});

describe('checking servers', () => {
  test('checks every server that is on, or the one you name, and keeps when it checked', async () => {
    const { extensions, checked, machine } = createWorld();
    extensions.updateServerChoice('claude:linear', { enabled: false });
    extensions.updateServerChoice(`claude_project:${machine.repo}:local`, { enabled: false });
    extensions.updateServerChoice('codex:maple', { enabled: false });
    extensions.updatePluginChoice('docs@market', false);
    const snapshot = await extensions.check();
    expect(checked.map((definition) => definition.command)).toEqual(['npx', 'node']);
    expect(checked[0]?.env).toEqual({ ...RETINA, ROOT: machine.userHome, PLAYWRIGHT_MCP_HEADLESS: 'true' });
    expect(findServer(snapshot.servers, 'claude:files').status).toEqual({
      state: 'connected',
      error: null,
      checkedAt: 42,
      tools: [{ name: 'echo', description: null }],
      tokens: 30,
    });
    await extensions.check('codex:kampala');
    expect(checked.at(-1)?.command).toBe('kampala');
  });

  test('a check outlives a restart, and editing the server forgets it', async () => {
    const { extensions, machine, state } = createWorld();
    await extensions.check('claude:files');
    const again = new Extensions({
      state: () => state,
      config: { home: machine.shinsaHome, userHome: machine.userHome, pluginDir: machine.pluginDir },
      secrets: new SecretStore(join(machine.shinsaHome, 'secrets.json')),
      baseUrl: () => 'http://127.0.0.1:5180',
      env: machine.env,
    });
    expect(findServer(again.snapshot().servers, 'claude:files').status.tokens).toBe(30);
    extensions.createServer({ name: 'docs', transport: 'http', url: 'https://a.dev/mcp' });
    await extensions.check('shinsa:docs');
    const edited = extensions.updateServer('shinsa:docs', { transport: 'http', url: 'https://b.dev/mcp' });
    expect(findServer(edited.servers, 'shinsa:docs').status.state).toBe('unchecked');
    const copied = extensions.updateServer('claude:files', {
      transport: 'stdio',
      command: 'npx',
      args: ['files-mcp'],
      env: { ROOT: '', MODE: 'read' },
    });
    expect(findServer(copied.servers, 'shinsa:files').status).toMatchObject({
      state: 'unchecked',
      tools: [],
    });
  });
});

describe('signing in from Shinsa', () => {
  test('Connect sends you to the server, the callback page signs you in, and agents get the token', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const { extensions, checked } = createWorld();
    extensions.createServer({ name: 'remote', transport: 'http', url: fake.mcpUrl });
    const started = await extensions.startSignIn('shinsa:remote');
    expect(started.authorizationUrl).toContain('/authorize');
    const redirect = await fetch(started.authorizationUrl ?? '', { redirect: 'manual' });
    const callback = new URL(redirect.headers.get('location') ?? '');
    expect(extensions.isCallback(callback.pathname)).toBe(true);
    expect(extensions.isCallback('/api/extensions')).toBe(false);
    const page = await extensions.finishSignIn(callback);
    expect(page).toContain('Signed in to remote');
    expect(checked.at(-1)?.headers.Authorization).toBe('Bearer access-1');
    expect(findServer(extensions.snapshot().servers, 'shinsa:remote').signedIn).toBe(true);
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers[0]?.definition.headers.Authorization).toBe('Bearer access-1');
    const again = await extensions.startSignIn('shinsa:remote');
    expect(again.authorizationUrl).toBeNull();
    expect(findServer(extensions.signOut('shinsa:remote').servers, 'shinsa:remote').signedIn).toBe(false);
  });

  test('Connect on a copied server knows you already signed in to the original', async () => {
    fake = startFakeMcpHttp({ oauth: true });
    const { extensions, machine } = createWorld();
    writeFile(
      machine.claudeConfig,
      JSON.stringify({ mcpServers: { remote: { type: 'http', url: fake.mcpUrl } } })
    );
    const started = await extensions.startSignIn('claude:remote');
    const redirect = await fetch(started.authorizationUrl ?? '', { redirect: 'manual' });
    await extensions.finishSignIn(new URL(redirect.headers.get('location') ?? ''));
    extensions.updateServer('claude:remote', {
      transport: 'http',
      url: fake.mcpUrl,
      headers: { 'X-Team': 'core' },
    });
    const again = await extensions.startSignIn('shinsa:remote');
    expect(again.authorizationUrl).toBeNull();
    expect(findServer(again.snapshot.servers, 'shinsa:remote').signedIn).toBe(true);
  });

  test('a server on this machine has no sign-in', async () => {
    const { extensions } = createWorld();
    await expect(extensions.startSignIn('claude:files')).rejects.toThrow('It runs here and has no sign-in.');
  });

  test('the callback page says why a sign-in did not finish', async () => {
    const { extensions } = createWorld();
    const base = 'http://127.0.0.1:5180/api/mcp/oauth/callback';
    expect(
      await extensions.finishSignIn(new URL(`${base}?error=access_denied&error_description=You%20said%20no`))
    ).toContain('You said no');
    expect(await extensions.finishSignIn(new URL(`${base}?state=s`))).toContain(
      'The server sent no sign-in code'
    );
    expect(await extensions.finishSignIn(new URL(`${base}?state=s&code=c`))).toContain(
      'This sign-in expired.'
    );
  });

  test('the page escapes what the server sent, and closes itself only on success', () => {
    const page = serializeSignInPage('<b>', '"x" & \'y\'', false);
    expect(page).toContain('&#60;b&#62;');
    expect(page).not.toContain('window.close');
    expect(serializeSignInPage('Signed in', 'ok', true)).toContain('window.close');
  });
});

describe('what an agent run loads', () => {
  test('every server that is on and used where the task runs, one per name', async () => {
    const { extensions, machine } = createWorld();
    extensions.updateServerChoice('codex:maple', { scope: { kind: 'project', project: 'p1' } });
    extensions.createServer({
      name: 'linear',
      transport: 'http',
      url: 'https://own.linear/mcp',
      enabled: false,
    });
    const inRepo = await extensions.resolveSession({ repoPath: machine.repo, project: 'p1' });
    expect(inRepo.servers.map((server) => server.name).sort()).toEqual([
      'files',
      'linear',
      'local',
      'maple',
      'plugin_docs_context',
      'repo_tools',
    ]);
    expect(inRepo.servers.find((server) => server.name === 'plugin_docs_context')?.claudeName).toBe(
      'plugin:docs:context'
    );
    expect(inRepo.servers.find((server) => server.name === 'linear')?.definition.url).toBe(
      'https://mcp.linear.example/mcp'
    );
    expect(inRepo.codexServersOff).toEqual(['kampala']);
    const elsewhere = await extensions.resolveSession({ repoPath: '/other', project: null });
    expect(elsewhere.servers.map((server) => server.name).sort()).toEqual([
      'files',
      'linear',
      'plugin_docs_context',
    ]);
    expect(elsewhere.codexServersOff).toEqual(['maple', 'kampala']);
  });

  test('every server a run starts on this machine keeps its browser out of sight', async () => {
    const { extensions, machine } = createWorld();
    writeFile(
      join(machine.repo, '.mcp.json'),
      JSON.stringify({
        mcpServers: {
          browser: {
            command: 'npx',
            args: ['@playwright/mcp@latest'],
            env: { PLAYWRIGHT_MCP_HEADLESS: 'false' },
          },
        },
      })
    );
    const session = await extensions.resolveSession({ repoPath: machine.repo, project: null });
    const browser = session.servers.find((server) => server.name === 'browser');
    expect(browser?.definition.env).toEqual({ ...RETINA, PLAYWRIGHT_MCP_HEADLESS: 'true' });
    const linear = session.servers.find((server) => server.name === 'linear');
    expect(linear?.definition.env).toEqual({});
  });

  test('two repositories that run the same command each get their own environment', async () => {
    const { extensions, machine, state } = createWorld();
    const other = join(machine.userHome, 'code', 'other');
    state.repos.r2 = {
      id: 'r2',
      name: 'other',
      path: other,
      defaultBranch: 'main',
      remote: null,
      projectId: null,
      checkCommands: [],
    };
    const database = (url: string) =>
      JSON.stringify({ mcpServers: { db: { command: 'db-mcp', env: { DATABASE_URL: url } } } });
    writeFile(join(machine.repo, '.mcp.json'), database('postgres://app'));
    writeFile(join(other, '.mcp.json'), database('postgres://other'));
    const inOther = await extensions.resolveSession({ repoPath: other, project: null });
    expect(inOther.servers.find((server) => server.name === 'db')?.definition.env).toEqual({
      ...RETINA,
      DATABASE_URL: 'postgres://other',
      PLAYWRIGHT_MCP_HEADLESS: 'true',
    });
    const inApp = await extensions.resolveSession({ repoPath: machine.repo, project: null });
    expect(inApp.servers.find((server) => server.name === 'db')?.definition.env).toEqual({
      ...RETINA,
      DATABASE_URL: 'postgres://app',
      PLAYWRIGHT_MCP_HEADLESS: 'true',
    });
  });

  test('every skill that is on, a repository’s only in that repository, and the plugins as they are switched', async () => {
    const { extensions, machine } = createWorld();
    const before = await extensions.resolveSession({ repoPath: machine.repo, project: null });
    expect(before.skills.map((skill) => skill.claudeName)).toEqual([
      'shinsa:review',
      'animate',
      'docs:lookup-docs',
      'conventions',
      null,
    ]);
    expect(before.plugins).toEqual({ 'docs@market': true, 'off@market': false });
    expect(before.skillsOff).toEqual([]);
    extensions.updateSkillChoice('user:animate', false);
    extensions.updateSkillChoice('codex:release', false);
    const after = await extensions.resolveSession({ repoPath: '/other', project: null });
    expect(after.skills.map((skill) => [skill.claudeName, skill.source])).toEqual([
      ['shinsa:review', 'shinsa'],
      ['docs:lookup-docs', 'plugin'],
    ]);
    expect(after.skillsOff).toEqual(['animate']);
  });

  test('a plugin turned off takes its skills and servers with it, and a run says what it loaded', async () => {
    const { extensions } = createWorld();
    await extensions.check('claude:files');
    const off = extensions.updatePluginChoice('docs@market', false);
    expect(off.plugins.find((plugin) => plugin.id === 'docs@market')?.enabled).toBe(false);
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.map((server) => server.name)).toEqual(['linear', 'files', 'maple']);
    expect(session.skills.map((skill) => skill.name)).toEqual(['review', 'animate', 'release']);
    expect(session.plugins).toEqual({ 'docs@market': false, 'off@market': false });
    expect(session.loaded).toEqual({
      servers: [
        { name: 'linear', tokens: null },
        { name: 'files', tokens: 30 },
        { name: 'maple', tokens: null },
      ],
      skills: [
        { name: 'shinsa:review', tokens: 9 },
        { name: 'animate', tokens: 8 },
        { name: 'release', tokens: 7 },
      ],
      plugins: [],
      deferred: [],
    });
    extensions.updatePluginChoice('off@market', true);
    const on = await extensions.resolveSession({ repoPath: null, project: null });
    expect(on.loaded.plugins).toEqual([{ name: 'off', tokens: 18 }]);
    expect(() => extensions.updatePluginChoice('off@market', 'yes')).toThrow('Turn the plugin on or off.');
    expect(() => extensions.updatePluginChoice('none@market', true)).toThrow('no plugin with that id');
  });
});
