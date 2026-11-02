import { resolveDisplayPath } from '@shinsa/core';
import { Option, Schema } from 'effect';
import { readMcpServers } from '../definitions.ts';
import {
  type ClaudeConfig,
  type ClaudePlugin,
  CodexServerSwitch,
  type DiscoveredServer,
  type DiscoveryPaths,
  Fields,
  type McpDefinition,
} from '../schema.ts';

const isCodexOff = Schema.is(CodexServerSwitch);

const decodeFields = Schema.decodeUnknownOption(Fields);

export function listClaudeServers(paths: DiscoveryPaths, config: ClaudeConfig | null): DiscoveredServer[] {
  if (!config) return [];
  const origin = resolveDisplayPath(paths.claudeConfig, paths.userHome);
  const user = readMcpServers(config.mcpServers).map(({ name, definition }) => ({
    id: `claude:${name}`,
    name,
    source: 'claude' as const,
    origin,
    definition,
    scope: null,
    enabled: true,
    plugin: null,
  }));
  const local = Object.entries(config.projects ?? {}).flatMap(([path, project]) => {
    const disabled = new Set(project.disabledMcpServers ?? []);
    return readMcpServers(project.mcpServers).map(({ name, definition }) => ({
      id: `claude_project:${path}:${name}`,
      name,
      source: 'claude_project' as const,
      origin: `${origin} · ${resolveDisplayPath(path, paths.userHome)}`,
      definition,
      scope: { kind: 'repo' as const, path },
      enabled: !disabled.has(name),
      plugin: null,
    }));
  });
  return [...user, ...local];
}

export function listProjectServers(
  paths: DiscoveryPaths,
  config: ClaudeConfig | null,
  repo: string,
  file: string,
  entries: unknown
): DiscoveredServer[] {
  const refused = new Set(config?.projects?.[repo]?.disabledMcpjsonServers ?? []);
  return readMcpServers(entries).map(({ name, definition }) => ({
    id: `project:${repo}:${name}`,
    name,
    source: 'project' as const,
    origin: resolveDisplayPath(file, paths.userHome),
    definition,
    scope: { kind: 'repo' as const, path: repo },
    enabled: !refused.has(name),
    plugin: null,
  }));
}

export function listCodexServers(
  paths: DiscoveryPaths,
  file: string,
  entries: Record<string, unknown>
): DiscoveredServer[] {
  return readMcpServers(entries).map(({ name, definition }) => ({
    id: `codex:${name}`,
    name,
    source: 'codex' as const,
    origin: resolveDisplayPath(file, paths.userHome),
    definition,
    scope: null,
    enabled: !isCodexOff(entries[name]),
    plugin: null,
  }));
}

function withPluginRoot(definition: McpDefinition, root: string): McpDefinition {
  const expand = (text: string) => text.replaceAll(`\${CLAUDE_PLUGIN_ROOT}`, root);
  return {
    ...definition,
    command: definition.command === null ? null : expand(definition.command),
    args: definition.args.map(expand),
    env: Object.fromEntries(Object.entries(definition.env).map(([key, text]) => [key, expand(text)])),
  };
}

export function resolvePluginEntries(plugin: ClaudePlugin, file: unknown) {
  return Option.match(decodeFields(file), {
    onNone: () => plugin.manifest?.mcpServers ?? null,
    onSome: (fields) => {
      const servers = decodeFields(fields.mcpServers);
      return Option.isSome(servers) ? servers.value : fields;
    },
  });
}

export function listPluginServers(plugin: ClaudePlugin, entries: unknown): DiscoveredServer[] {
  return readMcpServers(entries).map(({ name, definition }) => ({
    id: `plugin:${plugin.id}:${name}`,
    name,
    source: 'plugin' as const,
    origin: `${plugin.name} plugin`,
    definition: withPluginRoot(definition, plugin.root),
    scope: null,
    enabled: true,
    plugin: plugin.id,
  }));
}
