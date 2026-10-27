import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ExtensionScope, type McpSource, resolveDisplayPath } from '@shinsa/core';
import { describeError } from '../log/index.ts';
import { isFields, type McpDefinition, readMcpServers } from './definitions.ts';

export interface DiscoveryPaths {
  userHome: string;
  claudeDir: string;
  claudeConfig: string;
  codexHome: string;
  repos: string[];
}

interface DiscoveredServer {
  id: string;
  name: string;
  source: McpSource;
  origin: string;
  definition: McpDefinition;
  scope: ExtensionScope | null;
  enabled: boolean;
  plugin: string | null;
}

export interface ClaudePlugin {
  id: string;
  name: string;
  root: string;
  enabled: boolean;
  manifest: unknown;
}

function readJsonFile(path: string, userHome: string, problems: string[]): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`Could not read ${resolveDisplayPath(path, userHome)}: ${describeError(error)}`);
    return null;
  }
}

function readTomlFile(path: string, userHome: string, problems: string[]): unknown {
  if (!existsSync(path)) return null;
  try {
    return Bun.TOML.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`Could not read ${resolveDisplayPath(path, userHome)}: ${describeError(error)}`);
    return null;
  }
}

function readNames(value: unknown) {
  return new Set(
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  );
}

function readInstallRoot(entries: unknown) {
  if (!Array.isArray(entries)) return null;
  for (const entry of entries) {
    if (isFields(entry) && typeof entry.installPath === 'string' && existsSync(entry.installPath)) {
      return entry.installPath;
    }
  }
  return null;
}

export function listClaudePlugins(paths: DiscoveryPaths, problems: string[]): ClaudePlugin[] {
  const settings = readJsonFile(join(paths.claudeDir, 'settings.json'), paths.userHome, problems);
  const enabled = isFields(settings) && isFields(settings.enabledPlugins) ? settings.enabledPlugins : {};
  const installed = readJsonFile(
    join(paths.claudeDir, 'plugins', 'installed_plugins.json'),
    paths.userHome,
    problems
  );
  if (!isFields(installed) || !isFields(installed.plugins)) return [];
  return Object.entries(installed.plugins).flatMap(([id, entries]) => {
    const root = readInstallRoot(entries);
    if (!root) return [];
    return [
      {
        id,
        name: id.split('@')[0] ?? id,
        root,
        enabled: enabled[id] === true,
        manifest: readJsonFile(join(root, '.claude-plugin', 'plugin.json'), paths.userHome, problems),
      },
    ];
  });
}

function listClaudeServers(paths: DiscoveryPaths, config: unknown): DiscoveredServer[] {
  if (!isFields(config)) return [];
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
  const projects = isFields(config.projects) ? Object.entries(config.projects) : [];
  const local = projects.flatMap(([path, project]) => {
    const fields = isFields(project) ? project : {};
    const disabled = readNames(fields.disabledMcpServers);
    return readMcpServers(fields.mcpServers).map(({ name, definition }) => ({
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

function readProjectRefusals(config: unknown, repo: string) {
  if (!isFields(config) || !isFields(config.projects)) return new Set<string>();
  const project = config.projects[repo];
  return readNames(isFields(project) ? project.disabledMcpjsonServers : null);
}

function listProjectServers(paths: DiscoveryPaths, config: unknown, problems: string[]): DiscoveredServer[] {
  return paths.repos.flatMap((repo) => {
    const file = join(repo, '.mcp.json');
    const value = readJsonFile(file, paths.userHome, problems);
    if (!isFields(value)) return [];
    const refused = readProjectRefusals(config, repo);
    return readMcpServers(value.mcpServers).map(({ name, definition }) => ({
      id: `project:${repo}:${name}`,
      name,
      source: 'project' as const,
      origin: resolveDisplayPath(file, paths.userHome),
      definition,
      scope: { kind: 'repo' as const, path: repo },
      enabled: !refused.has(name),
      plugin: null,
    }));
  });
}

function listCodexServers(paths: DiscoveryPaths, problems: string[]): DiscoveredServer[] {
  const file = join(paths.codexHome, 'config.toml');
  const value = readTomlFile(file, paths.userHome, problems);
  if (!isFields(value)) return [];
  const entries = isFields(value.mcp_servers) ? value.mcp_servers : {};
  return readMcpServers(entries).map(({ name, definition }) => ({
    id: `codex:${name}`,
    name,
    source: 'codex' as const,
    origin: resolveDisplayPath(file, paths.userHome),
    definition,
    scope: null,
    enabled: !(isFields(entries[name]) && entries[name].enabled === false),
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

function readPluginEntries(plugin: ClaudePlugin, paths: DiscoveryPaths, problems: string[]) {
  const file = readJsonFile(join(plugin.root, '.mcp.json'), paths.userHome, problems);
  if (isFields(file)) return isFields(file.mcpServers) ? file.mcpServers : file;
  return isFields(plugin.manifest) ? plugin.manifest.mcpServers : null;
}

function listPluginServers(
  plugins: ClaudePlugin[],
  paths: DiscoveryPaths,
  problems: string[]
): DiscoveredServer[] {
  return plugins.flatMap((plugin) => {
    const entries = readPluginEntries(plugin, paths, problems);
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
  });
}

export function discoverServers(paths: DiscoveryPaths, plugins: ClaudePlugin[], problems: string[]) {
  const config = readJsonFile(paths.claudeConfig, paths.userHome, problems);
  return [
    ...listClaudeServers(paths, config),
    ...listProjectServers(paths, config, problems),
    ...listCodexServers(paths, problems),
    ...listPluginServers(plugins, paths, problems),
  ];
}
