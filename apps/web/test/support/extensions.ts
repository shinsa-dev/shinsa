import type {
  ExtensionsSnapshot,
  McpServerStatus,
  McpServerSummary,
  PluginSummary,
  SkillSummary,
} from '@shinsa/core';

export function createServer(
  overrides: Partial<McpServerSummary> & { id: string },
  status: Partial<McpServerStatus> = {}
): McpServerSummary {
  return {
    name: overrides.id,
    source: 'shinsa',
    origin: 'Shinsa',
    transport: 'http',
    command: null,
    args: [],
    url: `https://${overrides.id}.example/mcp`,
    envKeys: [],
    headerKeys: [],
    enabled: true,
    scope: { kind: 'everywhere' },
    editable: true,
    shadowedBy: null,
    signedIn: false,
    plugin: null,
    definedIn: [],
    lastUsedAt: null,
    deferred: false,
    ...overrides,
    status: { state: 'unchecked', error: null, checkedAt: null, tools: [], tokens: null, ...status },
  };
}

export function createSkill(overrides: Partial<SkillSummary> & { id: string }): SkillSummary {
  return {
    name: overrides.id,
    description: `What ${overrides.id} does.`,
    source: 'user',
    origin: '~/.claude/skills',
    plugin: null,
    repoPath: null,
    enabled: true,
    tokens: 500,
    lastUsedAt: null,
    deferred: false,
    ...overrides,
  };
}

export function createPlugin(overrides: Partial<PluginSummary> & { id: string }): PluginSummary {
  return {
    name: overrides.id,
    origin: `~/.claude/plugins/${overrides.id}`,
    enabled: true,
    skills: 0,
    agents: 0,
    commands: 0,
    servers: 0,
    hooks: false,
    tokens: 1_000,
    ...overrides,
  };
}

export function createExtensions(overrides: Partial<ExtensionsSnapshot> = {}): ExtensionsSnapshot {
  return {
    servers: [],
    skills: [],
    plugins: [],
    problems: [],
    optimizer: { enabled: false, days: 14, skills: false },
    usage: { readAt: null, since: null },
    ...overrides,
  };
}
