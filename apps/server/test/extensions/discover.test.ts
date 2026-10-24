import { describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expandDefinition, parseMcpEntry, readMcpServers } from '../../src/extensions/definitions.ts';
import { type DiscoveryPaths, discoverServers, listClaudePlugins } from '../../src/extensions/discover.ts';
import { discoverSkills, parseFrontmatter } from '../../src/extensions/skills.ts';
import { createFakeMachine, type FakeMachine, writeFile } from './fixtures.ts';

function resolvePaths(machine: FakeMachine): DiscoveryPaths {
  return {
    userHome: machine.userHome,
    claudeDir: machine.claudeDir,
    claudeConfig: machine.claudeConfig,
    codexHome: machine.codexHome,
    repos: [machine.repo],
  };
}

describe('reading an MCP server entry', () => {
  test('a command entry, an HTTP entry and an SSE entry, in Claude Code and Codex spellings', () => {
    expect(parseMcpEntry({ command: ' npx ', args: ['a', 1], env: { A: 'b', N: 2 } })).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['a'],
      env: { A: 'b' },
      cwd: null,
      url: null,
      headers: {},
      bearerTokenEnv: null,
    });
    expect(
      parseMcpEntry({ url: 'https://x.dev/mcp', http_headers: { H: 'v' }, bearer_token_env_var: 'TOKEN' })
    ).toMatchObject({
      transport: 'http',
      command: null,
      url: 'https://x.dev/mcp',
      headers: { H: 'v' },
      bearerTokenEnv: 'TOKEN',
    });
    expect(parseMcpEntry({ type: 'sse', url: 'https://x.dev/sse' })?.transport).toBe('sse');
    expect(parseMcpEntry({ type: 'streamable-http', url: 'https://x.dev/mcp' })?.transport).toBe('http');
  });

  test('an entry with nothing to start or reach is skipped', () => {
    expect(parseMcpEntry({ type: 'http' })).toBeNull();
    expect(parseMcpEntry({ type: 'stdio', url: 'https://x.dev' })).toBeNull();
    expect(parseMcpEntry('npx server')).toBeNull();
    expect(readMcpServers(['not', 'a', 'map'])).toEqual([]);
    expect(readMcpServers({ ok: { command: 'a' }, bad: {} }).map((entry) => entry.name)).toEqual(['ok']);
  });

  test('variables are filled in from the environment when an agent starts, and a bearer variable becomes a header', () => {
    const definition = parseMcpEntry({
      url: `https://\${HOST}/mcp`,
      headers: { 'X-Team': `\${TEAM:-core}` },
      bearer_token_env_var: 'TOKEN',
    });
    const stdio = parseMcpEntry({ command: `\${BIN}/run`, args: [`\${MISSING}`], env: { KEY: `\${KEY}` } });
    const env = { HOST: 'example.dev', TOKEN: 't-1', BIN: '/opt', KEY: 'k' };
    expect(expandDefinition(definition ?? stdio!, env)).toMatchObject({
      url: 'https://example.dev/mcp',
      headers: { 'X-Team': 'core', Authorization: 'Bearer t-1' },
    });
    expect(expandDefinition(stdio!, env)).toMatchObject({
      command: '/opt/run',
      args: [''],
      env: { KEY: 'k' },
    });
    expect(expandDefinition({ ...definition!, bearerTokenEnv: 'NOPE' }, env).headers).toEqual({
      'X-Team': 'core',
    });
  });
});

describe('finding MCP servers', () => {
  test('lists Claude Code’s own and per-project servers, a repository’s .mcp.json, Codex’s and each plugin’s', () => {
    const machine = createFakeMachine();
    const problems: string[] = [];
    const plugins = listClaudePlugins(resolvePaths(machine), problems);
    expect(plugins).toEqual([
      { id: 'docs@market', name: 'docs', root: machine.pluginRoot, enabled: true, manifest: null },
      { id: 'off@market', name: 'off', root: machine.pluginRoot, enabled: false, manifest: null },
    ]);
    const servers = discoverServers(resolvePaths(machine), plugins.slice(0, 1), problems);
    expect(problems).toEqual([]);
    expect(servers.map((server) => [server.id, server.source, server.origin])).toEqual([
      ['claude:linear', 'claude', '~/.claude/.claude.json'],
      ['claude:files', 'claude', '~/.claude/.claude.json'],
      [`claude_project:${machine.repo}:local`, 'claude_project', '~/.claude/.claude.json · ~/code/app'],
      [`project:${machine.repo}:repo_tools`, 'project', '~/code/app/.mcp.json'],
      ['codex:maple', 'codex', '~/.codex/config.toml'],
      ['codex:kampala', 'codex', '~/.codex/config.toml'],
      ['plugin:docs@market:context', 'plugin', 'docs plugin'],
    ]);
    expect(servers.find((server) => server.source === 'claude_project')?.scope).toEqual({
      kind: 'repo',
      path: machine.repo,
    });
    expect(servers.find((server) => server.id === 'codex:kampala')).toMatchObject({
      enabled: false,
      definition: { cwd: '/tmp' },
    });
    expect(servers.filter((server) => !server.enabled).map((server) => server.id)).toEqual(['codex:kampala']);
    expect(servers.find((server) => server.source === 'plugin')?.definition).toMatchObject({
      command: `${machine.pluginRoot}/bin/server`,
      args: ['--root', machine.pluginRoot],
      env: { DIR: machine.pluginRoot },
    });
  });

  test('never writes to the files it reads', () => {
    const machine = createFakeMachine();
    const before = readFileSync(machine.claudeConfig, 'utf8');
    discoverServers(resolvePaths(machine), listClaudePlugins(resolvePaths(machine), []), []);
    expect(readFileSync(machine.claudeConfig, 'utf8')).toBe(before);
  });

  test('a plugin can declare its servers in its manifest, or as a bare map', () => {
    const machine = createFakeMachine();
    writeFileSync(join(machine.pluginRoot, '.mcp.json'), JSON.stringify({ bare: { command: 'b' } }));
    const plugins = listClaudePlugins(resolvePaths(machine), []);
    expect(discoverServers(resolvePaths(machine), plugins, []).at(-1)?.name).toBe('bare');
    const manifestRoot = join(machine.userHome, 'manifest-plugin');
    const fromManifest = discoverServers(
      resolvePaths(machine),
      [
        {
          id: 'm@x',
          name: 'm',
          root: manifestRoot,
          enabled: true,
          manifest: { mcpServers: { fromManifest: { command: 'm' } } },
        },
      ],
      []
    );
    expect(fromManifest.at(-1)?.id).toBe('plugin:m@x:fromManifest');
    const emptyRoot = join(machine.userHome, 'empty-plugin');
    mkdirSync(emptyRoot);
    expect(
      discoverServers(
        resolvePaths(machine),
        [{ id: 'e@x', name: 'e', root: emptyRoot, enabled: true, manifest: null }],
        []
      ).some((s) => s.source === 'plugin')
    ).toBe(false);
  });

  test('servers you turned off in Claude Code for a project start off here too', () => {
    const machine = createFakeMachine();
    const config = JSON.parse(readFileSync(machine.claudeConfig, 'utf8'));
    config.projects[machine.repo].disabledMcpServers = ['local'];
    config.projects[machine.repo].disabledMcpjsonServers = ['repo_tools'];
    writeFileSync(machine.claudeConfig, JSON.stringify(config));
    const servers = discoverServers(resolvePaths(machine), [], []);
    expect(servers.filter((server) => !server.enabled).map((server) => server.name)).toEqual([
      'local',
      'repo_tools',
      'kampala',
    ]);
  });

  test('files it cannot read are named as problems, and the rest still loads', () => {
    const machine = createFakeMachine();
    writeFileSync(machine.claudeConfig, '{ not json');
    writeFileSync(join(machine.codexHome, 'config.toml'), '[[[ not toml');
    writeFileSync(join(machine.claudeDir, 'plugins', 'installed_plugins.json'), '[]');
    const problems: string[] = [];
    const servers = discoverServers(
      resolvePaths(machine),
      listClaudePlugins(resolvePaths(machine), problems),
      problems
    );
    expect(servers.map((server) => server.source)).toEqual(['project']);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toStartWith('Could not read ~/.claude/.claude.json');
    expect(problems[1]).toStartWith('Could not read ~/.codex/config.toml');
  });

  test('a machine without Claude Code or Codex has nothing to find', () => {
    const empty = {
      userHome: '/nowhere',
      claudeDir: '/nowhere/.claude',
      claudeConfig: '/nowhere/.claude.json',
      codexHome: '/nowhere/.codex',
      repos: [],
    };
    expect(listClaudePlugins(empty, [])).toEqual([]);
    expect(discoverServers(empty, [], [])).toEqual([]);
    const machine = createFakeMachine();
    writeFileSync(machine.claudeConfig, JSON.stringify({ theme: 'dark' }));
    writeFileSync(join(machine.claudeDir, 'settings.json'), '[]');
    writeFileSync(join(machine.codexHome, 'config.toml'), 'model = "x"');
    writeFileSync(join(machine.repo, '.mcp.json'), '[]');
    const plugins = listClaudePlugins(resolvePaths(machine), []);
    expect(plugins.map((plugin) => plugin.enabled)).toEqual([false, false]);
    expect(discoverServers(resolvePaths(machine), [], [])).toEqual([]);
  });
});

describe('finding skills', () => {
  test('reads a skill’s name and description, quoted or folded over lines', () => {
    expect(parseFrontmatter('---\nname: "pdf"\ndescription: \'Reads PDFs.\'\n---\nbody')).toEqual({
      name: 'pdf',
      description: 'Reads PDFs.',
    });
    expect(
      parseFrontmatter(
        '---\nname: deep\ndescription: >\n  Researches a topic\n  in depth.\nlicense: MIT\n---'
      )
    ).toEqual({
      name: 'deep',
      description: 'Researches a topic in depth.',
    });
    expect(parseFrontmatter('---\n# no fields\n---')).toEqual({ name: null, description: '' });
    expect(parseFrontmatter('no frontmatter')).toEqual({ name: null, description: '' });
  });

  test('lists Shinsa’s, your Claude Code skills, each plugin’s, each repository’s and Codex’s', () => {
    const machine = createFakeMachine();
    writeFile(
      join(machine.claudeDir, 'skills', 'unnamed', 'SKILL.md'),
      `---\ndescription: ${'x'.repeat(400)}\n---`
    );
    mkdirSync(join(machine.claudeDir, 'skills', 'empty-folder'), { recursive: true });
    const plugins = listClaudePlugins(resolvePaths(machine), []);
    const skills = discoverSkills(resolvePaths(machine), plugins, machine.pluginDir);
    expect(skills.map((skill) => [skill.id, skill.source, skill.claudeName, skill.origin])).toEqual([
      ['shinsa:review', 'shinsa', 'shinsa:review', 'Shinsa'],
      ['user:animate', 'user', 'animate', '~/.claude/skills'],
      ['user:unnamed', 'user', 'unnamed', '~/.claude/skills'],
      ['plugin:docs@market:lookup-docs', 'plugin', 'docs:lookup-docs', 'docs plugin'],
      ['plugin:off@market:lookup-docs', 'plugin', 'off:lookup-docs', 'off plugin'],
      [`project:${machine.repo}:conventions`, 'project', 'conventions', '~/code/app/.claude/skills'],
      ['codex:release', 'codex', null, '~/.codex/skills'],
    ]);
    expect(skills.find((skill) => skill.id === 'user:unnamed')?.description).toHaveLength(300);
    expect(skills.find((skill) => skill.id === 'user:unnamed')?.tokens).toBe(103);
    expect(skills.find((skill) => skill.source === 'project')?.repoPath).toBe(machine.repo);
  });
});
