import {
  type ExtensionPlace,
  type ExtensionScope,
  isScopeMatch,
  type McpSource,
  type PluginSummary,
} from '@shinsa/core';
import type { McpDefinition } from './definitions.ts';
import type { ClaudePlugin } from './discover.ts';
import type { FoundSkill } from './skills.ts';

export interface CatalogServer {
  id: string;
  name: string;
  source: McpSource;
  origin: string;
  definition: McpDefinition;
  enabled: boolean;
  scope: ExtensionScope;
  editable: boolean;
  plugin: string | null;
}

export interface ServerGroup {
  key: string;
  lead: CatalogServer;
  members: CatalogServer[];
}

export interface CatalogSkill extends FoundSkill {
  enabled: boolean;
}

interface CatalogPlugin extends ClaudePlugin {
  summary: PluginSummary;
  ownTokens: number;
}

export interface Catalog {
  servers: CatalogServer[];
  groups: ServerGroup[];
  skills: CatalogSkill[];
  plugins: CatalogPlugin[];
  problems: string[];
}

const SOURCE_ORDER: McpSource[] = ['shinsa', 'project', 'claude_project', 'claude', 'codex', 'plugin'];

function rankSource(source: McpSource) {
  return SOURCE_ORDER.indexOf(source);
}

function resolvePluginName(server: CatalogServer) {
  return server.plugin?.split('@')[0] ?? null;
}

export function resolveRuntimeName(server: CatalogServer) {
  const plugin = resolvePluginName(server);
  return plugin === null ? server.name : `plugin_${plugin}_${server.name}`;
}

export function resolveClaudeName(server: CatalogServer) {
  const plugin = resolvePluginName(server);
  return plugin === null ? server.name : `plugin:${plugin}:${server.name}`;
}

function resolveServerKey(definition: McpDefinition) {
  if (definition.transport === 'stdio') {
    return `stdio ${[definition.command ?? '', ...definition.args].join(' ')}`;
  }
  return `web ${(definition.url ?? '').replace(/\/+$/, '')}`;
}

export function groupServers(servers: CatalogServer[]): ServerGroup[] {
  const groups = new Map<string, CatalogServer[]>();
  for (const server of servers) {
    const key = resolveServerKey(server.definition);
    groups.set(key, [...(groups.get(key) ?? []), server]);
  }
  return [...groups.entries()].map(([key, members]) => {
    const lead = members.reduce((best, member) =>
      rankSource(member.source) < rankSource(best.source) ? member : best
    );
    return { key, lead, members };
  });
}

export function selectGroup(groups: ServerGroup[], id: unknown) {
  return groups.find((group) => group.members.some((member) => member.id === id)) ?? null;
}

export function isPluginOn(catalog: Pick<Catalog, 'plugins'>, pluginId: string | null) {
  if (pluginId === null) return true;
  return catalog.plugins.find((plugin) => plugin.id === pluginId)?.summary.enabled ?? true;
}

export function listUsedMembers(catalog: Pick<Catalog, 'plugins'>, group: ServerGroup) {
  return group.members.filter((member) => member.enabled && isPluginOn(catalog, member.plugin));
}

export function selectMemberInPlace(
  catalog: Pick<Catalog, 'plugins'>,
  group: ServerGroup,
  place: ExtensionPlace
) {
  return listUsedMembers(catalog, group)
    .filter((member) => isScopeMatch(member.scope, place))
    .reduce<CatalogServer | null>(
      (best, member) => (best && rankSource(best.source) <= rankSource(member.source) ? best : member),
      null
    );
}

export function resolveGroupScope(catalog: Pick<Catalog, 'plugins'>, group: ServerGroup): ExtensionScope {
  const used = listUsedMembers(catalog, group);
  if (used.some((member) => member.scope.kind === 'everywhere')) return { kind: 'everywhere' };
  return (used[0] ?? group.lead).scope;
}

export function resolveWinners(groups: ServerGroup[]) {
  const winners = new Map<string, ServerGroup>();
  for (const group of [...groups].sort((a, b) => rankSource(a.lead.source) - rankSource(b.lead.source))) {
    const name = resolveRuntimeName(group.lead);
    if (!winners.has(name)) winners.set(name, group);
  }
  return winners;
}
