import { describe, expect, spyOn, test } from 'bun:test';
import { join } from 'node:path';
import { createState, type McpServerSummary, type ShinsaState } from '@shinsa/core';
import { Extensions, type ServerCheck } from '../../src/extensions/index.ts';
import { UsageIndex } from '../../src/extensions/usage.ts';
import { log } from '../../src/log/index.ts';
import { SecretStore } from '../../src/secrets/store.ts';
import { createFakeMachine, serializeClaudeToolUse, writeFile, writeSkill } from './fixtures.ts';

const DAY = 86_400_000;

const NOW = Date.parse('2026-10-20T12:00:00Z');

const check: ServerCheck = () =>
  Promise.resolve({
    state: 'connected',
    error: null,
    tools: [{ name: 'search', description: null }],
    tokens: 4000,
  });

function createWorld() {
  const machine = createFakeMachine();
  writeFile(
    machine.claudeConfig,
    JSON.stringify({
      mcpServers: {
        maple: { type: 'http', url: 'https://api.maple.dev/mcp' },
        kampala: { command: 'kampala', args: ['mcp'] },
        linear: { type: 'http', url: 'https://mcp.linear.example/mcp' },
      },
      projects: {
        [machine.repo]: { mcpServers: { maple: { type: 'http', url: 'https://api.maple.dev/mcp/' } } },
        '/code/ios': { mcpServers: { maple: { type: 'http', url: 'https://api.maple.dev/mcp' } } },
      },
    })
  );
  writeFile(
    join(machine.codexHome, 'config.toml'),
    '[mcp_servers.maple]\nurl = "https://api.maple.dev/mcp"\n[mcp_servers.kampala]\ncommand = "kampala"\nargs = ["mcp"]\n'
  );
  const sessions = join(machine.claudeDir, 'projects', '-code-app', 'session.jsonl');
  writeFile(
    sessions,
    [
      serializeClaudeToolUse('mcp__linear__list', NOW - 2 * DAY),
      serializeClaudeToolUse('mcp__kampala__flows', NOW - 40 * DAY),
      serializeClaudeToolUse('Skill', NOW - DAY, { skill: 'animate' }),
      '',
    ].join('\n')
  );
  writeSkill(join(machine.claudeDir, 'skills'), 'stale', 'Never used.');
  const state: ShinsaState = createState();
  state.repos.r1 = {
    id: 'r1',
    name: 'app',
    path: machine.repo,
    defaultBranch: 'main',
    remote: null,
    projectId: null,
    checkCommands: [],
  };
  let now = NOW;
  const usage = new UsageIndex({
    sources: [{ dir: join(machine.claudeDir, 'projects'), kind: 'claude' }],
    cachePath: null,
    now: () => now,
  });
  const extensions = new Extensions({
    state: () => state,
    config: { home: machine.shinsaHome, userHome: machine.userHome, pluginDir: machine.pluginDir },
    secrets: new SecretStore(join(machine.shinsaHome, 'secrets.json')),
    baseUrl: () => 'http://127.0.0.1:5180',
    env: machine.env,
    check,
    now: () => now,
    usage,
  });
  return {
    machine,
    extensions,
    usage,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function findServer(servers: McpServerSummary[], name: string) {
  const server = servers.find((entry) => entry.name === name);
  if (!server) throw new Error(`No ${name}`);
  return server;
}

describe('one server defined in several places', () => {
  test('is one row that lists where it is defined, led by the place that wins', () => {
    const { extensions, machine } = createWorld();
    const servers = extensions.snapshot().servers.filter((server) => server.name === 'maple');
    expect(servers).toHaveLength(1);
    expect(servers[0]?.id).toBe(`claude_project:${machine.repo}:maple`);
    expect(servers[0]?.scope).toEqual({ kind: 'everywhere' });
    expect(servers[0]?.definedIn.map((place) => place.id)).toEqual([
      'claude:maple',
      `claude_project:${machine.repo}:maple`,
      'claude_project:/code/ios:maple',
      'codex:maple',
    ]);
    expect(
      findServer(extensions.snapshot().servers, 'kampala').definedIn.map((place) => place.source)
    ).toEqual(['claude', 'codex']);
  });

  test('turns on and off as one, checks once and loads once', async () => {
    const { extensions } = createWorld();
    const off = extensions.updateServerChoice('codex:maple', { enabled: false });
    expect(findServer(off.servers, 'maple').enabled).toBe(false);
    expect(findServer(off.servers, 'maple').definedIn.every((place) => !place.enabled)).toBe(true);
    const on = extensions.updateServerChoice('claude:maple', { enabled: true });
    expect(findServer(on.servers, 'maple').enabled).toBe(true);
    const checked = await extensions.check('claude_project:/code/ios:maple');
    expect(findServer(checked.servers, 'maple').status.tokens).toBe(4000);
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.filter((server) => server.name === 'maple')).toHaveLength(1);
    expect(session.codexServersOff).toEqual([]);
  });
});

describe('the context optimizer', () => {
  test('starts off, so a run loads every server it has', async () => {
    const { extensions, usage } = createWorld();
    await usage.refresh();
    expect(extensions.snapshot().optimizer).toEqual({ enabled: false, days: 14, skills: false });
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.map((server) => server.name).sort()).toEqual([
      'kampala',
      'linear',
      'maple',
      'plugin_docs_context',
    ]);
    expect(session.deferred).toEqual([]);
    expect(extensions.createLoader(session)).toBeNull();
  });

  test('once on, leaves out what agents have not used in its window and offers to load it', async () => {
    const { extensions, usage } = createWorld();
    extensions.snapshot();
    await usage.refresh();
    await extensions.check();
    const chosen = extensions.updateOptimizer({ enabled: true, days: 30, skills: true });
    expect(chosen.optimizer).toEqual({ enabled: true, days: 30, skills: true });
    expect(chosen.usage).toEqual({ readAt: NOW, since: NOW - 90 * DAY });
    expect(findServer(chosen.servers, 'kampala')).toMatchObject({
      lastUsedAt: NOW - 40 * DAY,
      deferred: true,
    });
    expect(findServer(chosen.servers, 'linear')).toMatchObject({
      lastUsedAt: NOW - 2 * DAY,
      deferred: false,
    });
    expect(chosen.skills.find((skill) => skill.name === 'stale')).toMatchObject({
      lastUsedAt: null,
      deferred: true,
    });
    expect(chosen.skills.find((skill) => skill.name === 'animate')).toMatchObject({ deferred: false });
    expect(chosen.skills.find((skill) => skill.source === 'shinsa')?.deferred).toBe(false);
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.map((server) => server.name)).toEqual(['linear']);
    expect(session.deferred.map((server) => [server.name, server.tools, server.tokens])).toEqual([
      ['maple', ['search'], 4000],
      ['kampala', ['search'], 4000],
      ['plugin_docs_context', ['search'], 4000],
    ]);
    expect(session.codexServersOff).toEqual(['maple', 'kampala']);
    expect(session.skillsOff).toContain('stale');
    expect(session.skills.map((skill) => skill.name)).toEqual(['review', 'animate']);
    expect(session.deferredSkills.map((skill) => skill.name)).toEqual([
      'stale',
      'docs:lookup-docs',
      'release',
    ]);
    expect(session.loaded.deferred?.map((item) => item.name)).toContain('kampala');
    const loader = extensions.createLoader(session);
    expect(loader?.listSpecs().map((spec) => spec.name)).toEqual([
      'load_mcp_server',
      'call_mcp_tool',
      'load_skill',
    ]);
  });

  test('a server an agent used since the last read is loaded by the next run', async () => {
    const { extensions, usage, machine, advance } = createWorld();
    extensions.snapshot();
    await usage.refresh();
    extensions.updateOptimizer({ enabled: true, days: 30 });
    writeFile(
      join(machine.claudeDir, 'projects', '-code-app', 'later.jsonl'),
      `${serializeClaudeToolUse('mcp__kampala__flows', NOW)}\n`
    );
    advance(60_000);
    const session = await extensions.resolveSession({ repoPath: null, project: null });
    expect(session.servers.map((server) => server.name)).toContain('kampala');
    expect(session.deferred.map((server) => server.name)).not.toContain('kampala');
  });

  test('never leaves out something added since Shinsa started watching until its window has passed', async () => {
    const { extensions, usage, advance, machine } = createWorld();
    extensions.snapshot();
    await usage.refresh();
    extensions.updateOptimizer({ enabled: true, days: 7 });
    writeFile(
      machine.claudeConfig,
      JSON.stringify({ mcpServers: { fresh: { type: 'http', url: 'https://fresh.example/mcp' } } })
    );
    expect(findServer(extensions.snapshot().servers, 'fresh').deferred).toBe(false);
    advance(8 * DAY);
    expect(findServer(extensions.snapshot().servers, 'fresh').deferred).toBe(true);
  });

  test('does nothing until it has read the sessions, and refuses settings it cannot keep', () => {
    const { extensions } = createWorld();
    extensions.updateOptimizer({ enabled: true });
    expect(findServer(extensions.snapshot().servers, 'kampala').deferred).toBe(false);
    expect(() => extensions.updateOptimizer('on')).toThrow('Say what to change.');
    expect(() => extensions.updateOptimizer({ enabled: 'yes' })).toThrow('Turn the optimizer on or off.');
    expect(() => extensions.updateOptimizer({ skills: 1 })).toThrow('also leaves out skills');
    expect(() => extensions.updateOptimizer({ days: 0 })).toThrow('from 1 to 365');
    expect(() => extensions.updateOptimizer({ days: 2.5 })).toThrow('from 1 to 365');
    expect(extensions.updateOptimizer({}).optimizer).toEqual({ enabled: true, days: 14, skills: false });
  });
});

describe('Shinsa’s own skills', () => {
  test('are always on and cannot be turned off', () => {
    const { extensions } = createWorld();
    expect(() => extensions.updateSkillChoice('shinsa:review', false)).toThrow(
      'Shinsa’s own skills are always on.'
    );
  });
});

describe('reading usage in the background', () => {
  test('a read that fails is logged, and stopping waits for the read', async () => {
    const { extensions, usage } = createWorld();
    const refresh = spyOn(usage, 'refresh').mockImplementation(() => Promise.reject(new Error('disk gone')));
    const warn = spyOn(log, 'warn');
    await extensions.syncUsage();
    expect(warn).toHaveBeenCalledWith('[Extensions] Could not read which servers and skills agents used', {
      error: 'disk gone',
    });
    refresh.mockRestore();
    warn.mockRestore();
    expect(await extensions.stop()).toBeUndefined();
  });
});
