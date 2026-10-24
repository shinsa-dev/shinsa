import { describe, expect, test } from 'bun:test';
import type { ExtensionsSnapshot } from '@shinsa/core';
import { createFakeClient, runSpec } from './fixtures.ts';

const SNAPSHOT: ExtensionsSnapshot = {
  servers: [
    {
      id: 'claude:linear',
      name: 'linear',
      source: 'claude',
      origin: '~/.claude.json',
      transport: 'http',
      command: null,
      args: [],
      url: 'https://mcp.linear.app/mcp',
      envKeys: [],
      headerKeys: [],
      enabled: true,
      scope: { kind: 'everywhere' },
      editable: false,
      shadowedBy: null,
      signedIn: false,
      plugin: null,
      status: { state: 'needs_sign_in', error: null, checkedAt: 1, tools: [], tokens: null },
      definedIn: [],
      lastUsedAt: null,
      deferred: false,
    },
    {
      id: 'shinsa:files',
      name: 'files',
      source: 'shinsa',
      origin: 'Shinsa',
      transport: 'stdio',
      command: 'npx',
      args: ['files-mcp'],
      url: null,
      envKeys: [],
      headerKeys: [],
      enabled: false,
      scope: { kind: 'everywhere' },
      editable: true,
      shadowedBy: null,
      signedIn: false,
      plugin: null,
      status: {
        state: 'connected',
        error: null,
        checkedAt: 1,
        tools: [{ name: 'read', description: null }],
        tokens: 120,
      },
      definedIn: [],
      lastUsedAt: null,
      deferred: false,
    },
  ],
  skills: [
    {
      id: 'user:animate',
      name: 'animate',
      description: 'Builds an animation.',
      source: 'user',
      origin: '~/.claude/skills',
      plugin: null,
      repoPath: null,
      enabled: true,
      tokens: 9,
      lastUsedAt: null,
      deferred: false,
    },
  ],
  plugins: [
    {
      id: 'docs@market',
      name: 'docs',
      origin: '~/.claude/plugins/cache/market/docs',
      enabled: false,
      skills: 1,
      agents: 2,
      commands: 0,
      servers: 1,
      hooks: false,
      tokens: 40,
    },
  ],
  problems: ['Could not read ~/.codex/config.toml: bad'],
  optimizer: { enabled: false, days: 14, skills: false },
  usage: { readAt: null, since: null },
};

const EMPTY: ExtensionsSnapshot = {
  servers: [],
  skills: [],
  plugins: [],
  problems: [],
  optimizer: { enabled: false, days: 14, skills: false },
  usage: { readAt: null, since: null },
};

describe('MCP servers, skills and plugins from the command line', () => {
  test('lists servers with their state, origin, target, tools and cost, then the problems', async () => {
    const fake = createFakeClient({ '/api/extensions': SNAPSHOT });
    expect((await runSpec(fake, ['mcp', 'list'])).text.split('\n')).toEqual([
      'claude:linear  needs sign_in  ~/.claude.json  https://mcp.linear.app/mcp',
      'shinsa:files  off  Shinsa  npx files-mcp  1 tools  ~120 tokens',
      'Could not read ~/.codex/config.toml: bad',
    ]);
    expect((await runSpec(fake, ['skills', 'list'])).text).toBe(
      'user:animate  on  ~/.claude/skills  ~9 tokens'
    );
    expect((await runSpec(fake, ['plugins', 'list'])).text).toBe(
      'docs@market  off  1 skills, 2 agents, 1 servers  ~40 tokens'
    );
  });

  test('with nothing set up, each list says so', async () => {
    const fake = createFakeClient({ '/api/extensions': EMPTY });
    expect((await runSpec(fake, ['mcp', 'list'])).text).toBe('No MCP servers.');
    expect((await runSpec(fake, ['skills', 'list'])).text).toBe('No skills.');
    expect((await runSpec(fake, ['plugins', 'list'])).text).toBe('No plugins.');
  });

  test('checks every server or one by name, and turns servers, skills and plugins on or off by name or id', async () => {
    const fake = createFakeClient({
      '/api/extensions': SNAPSHOT,
      '/api/extensions/check': EMPTY,
      '/api/extensions/servers/choose': SNAPSHOT,
      '/api/extensions/skills/choose': SNAPSHOT,
      '/api/extensions/plugins/choose': SNAPSHOT,
    });
    expect((await runSpec(fake, ['mcp', 'check'])).text).toBe('No MCP servers.');
    await runSpec(fake, ['mcp', 'check', 'linear']);
    expect((await runSpec(fake, ['mcp', 'off', 'linear'])).text).toBe('Turned linear off for agents.');
    expect((await runSpec(fake, ['mcp', 'on', 'shinsa:files'])).text).toBe('Turned files on for agents.');
    expect((await runSpec(fake, ['skills', 'off', 'animate'])).text).toBe('Turned the animate skill off.');
    expect((await runSpec(fake, ['plugins', 'on', 'docs'])).text).toBe('Turned the docs plugin on.');
    expect(fake.posts).toEqual([
      { path: '/api/extensions/check', body: {} },
      { path: '/api/extensions/check', body: { serverId: 'claude:linear' } },
      { path: '/api/extensions/servers/choose', body: { serverId: 'claude:linear', enabled: false } },
      { path: '/api/extensions/servers/choose', body: { serverId: 'shinsa:files', enabled: true } },
      { path: '/api/extensions/skills/choose', body: { skillId: 'user:animate', enabled: false } },
      { path: '/api/extensions/plugins/choose', body: { pluginId: 'docs@market', enabled: true } },
    ]);
    await expect(runSpec(fake, ['mcp', 'on', 'nothing'])).rejects.toThrow(
      'There is no server named nothing.'
    );
  });

  test('adds a command or an address, removes one, and signs in and out', async () => {
    let signedIn = false;
    const fake = createFakeClient({
      '/api/extensions': SNAPSHOT,
      '/api/extensions/servers/add': SNAPSHOT,
      '/api/extensions/servers/remove': SNAPSHOT,
      '/api/extensions/servers/sign-out': SNAPSHOT,
      '/api/extensions/servers/sign-in': () => {
        const answer = { authorizationUrl: signedIn ? null : 'https://auth.example/authorize' };
        signedIn = true;
        return answer;
      },
    });
    expect((await runSpec(fake, ['mcp', 'add', 'notes', '--', 'npx', 'notes-mcp', '--stdio'])).text).toBe(
      'Added notes. Agents load it from their next run.'
    );
    await runSpec(fake, ['mcp', 'add', 'remote', '--url', 'https://r.dev/mcp']);
    await runSpec(fake, ['mcp', 'add', 'feed', '--url', 'https://r.dev/sse', '--sse']);
    await runSpec(fake, ['mcp', 'add', 'bare']);
    expect(fake.posts.map((post) => post.body)).toEqual([
      { server: { name: 'notes', transport: 'stdio', command: 'npx', args: ['notes-mcp', '--stdio'] } },
      { server: { name: 'remote', transport: 'http', url: 'https://r.dev/mcp' } },
      { server: { name: 'feed', transport: 'sse', url: 'https://r.dev/sse' } },
      { server: { name: 'bare', transport: 'stdio', command: '', args: [] } },
    ]);
    expect((await runSpec(fake, ['mcp', 'remove', 'files'])).text).toBe('Removed files.');
    expect((await runSpec(fake, ['mcp', 'sign-in', 'linear'])).text).toBe(
      'Open this page to sign in to linear:\nhttps://auth.example/authorize'
    );
    expect((await runSpec(fake, ['mcp', 'sign-in', 'linear'])).text).toBe('Already signed in to linear.');
    expect((await runSpec(fake, ['mcp', 'sign-out', 'linear'])).text).toBe('Signed out of linear.');
  });
});
