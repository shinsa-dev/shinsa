import type { ExtensionPlace, LoadedExtensions, SkillSource } from '@shinsa/core';
import type { Catalog, CatalogSkill } from './catalog.ts';
import type { McpDefinition } from './definitions.ts';
import {
  type DeferredServer,
  type DeferredSkill,
  describeServerChoice,
  ExtensionLoader,
  type OpenClient,
} from './loader.ts';

interface SessionMcpServer {
  name: string;
  claudeName: string;
  definition: McpDefinition;
}

interface SessionSkill {
  name: string;
  description: string;
  path: string;
  claudeName: string | null;
  source: SkillSource;
}

export interface SessionExtensions {
  servers: SessionMcpServer[];
  skills: SessionSkill[];
  plugins: Record<string, boolean>;
  skillsOff: string[];
  codexServersOff: string[];
  deferred: DeferredServer[];
  deferredSkills: DeferredSkill[];
  loaded: LoadedExtensions;
}

export interface SessionExtensionSource {
  resolveSession: (place: ExtensionPlace, pin?: LoadedExtensions | null) => Promise<SessionExtensions>;
  createLoader?: (extensions: SessionExtensions) => ExtensionLoader | null;
}

interface SessionParts {
  catalog: Catalog;
  servers: (SessionMcpServer & { tokens: number | null })[];
  deferred: DeferredServer[];
  inPlace: CatalogSkill[];
  skills: CatalogSkill[];
  skippedSkills: CatalogSkill[];
}

export function listSkillsInPlace(catalog: Catalog, place: ExtensionPlace) {
  return catalog.skills.filter((skill) => skill.repoPath === null || skill.repoPath === place.repoPath);
}

function resolveSkillName(skill: CatalogSkill) {
  return skill.claudeName ?? skill.name;
}

export function serializeSession(parts: SessionParts): SessionExtensions {
  const { catalog, servers, deferred, inPlace, skills, skippedSkills } = parts;
  const names = new Set(servers.map((server) => server.name));
  return {
    servers: servers.map(({ name, claudeName, definition }) => ({ name, claudeName, definition })),
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      path: skill.path,
      claudeName: skill.claudeName,
      source: skill.source,
    })),
    plugins: Object.fromEntries(catalog.plugins.map((plugin) => [plugin.id, plugin.summary.enabled])),
    skillsOff: [...inPlace.filter((skill) => !skill.enabled), ...skippedSkills].flatMap((skill) =>
      skill.claudeName === null ? [] : [skill.claudeName]
    ),
    codexServersOff: catalog.servers
      .filter((server) => server.source === 'codex' && !names.has(server.name))
      .map((server) => server.name),
    deferred,
    deferredSkills: skippedSkills.map((skill) => ({
      name: resolveSkillName(skill),
      description: skill.description,
      path: skill.path,
    })),
    loaded: {
      servers: servers.map((server) => ({ name: server.claudeName, tokens: server.tokens })),
      skills: skills.map((skill) => ({ name: resolveSkillName(skill), tokens: skill.tokens })),
      plugins: catalog.plugins
        .filter((plugin) => plugin.summary.enabled)
        .map((plugin) => ({ name: plugin.name, tokens: plugin.ownTokens })),
      deferred: [
        ...deferred.map((server) => ({ name: server.claudeName, tokens: server.tokens })),
        ...skippedSkills.map((skill) => ({ name: resolveSkillName(skill), tokens: skill.tokens })),
      ],
    },
  };
}

export function resolvePinnedDeferral(
  pin: LoadedExtensions | null,
  kind: 'servers' | 'skills',
  name: string
): boolean | null {
  if (!pin) return null;
  if (pin[kind].some((entry) => entry.name === name)) return false;
  if ((pin.deferred ?? []).some((entry) => entry.name === name)) return true;
  return null;
}

function listExtensionNames(loaded: LoadedExtensions) {
  const { servers, skills, plugins, deferred = [] } = loaded;
  return [servers, skills, plugins, deferred].map((entries) =>
    entries
      .map((entry) => entry.name)
      .sort()
      .join('\n')
  );
}

export function isSameExtensionSet(left: LoadedExtensions, right: LoadedExtensions) {
  const before = listExtensionNames(left);
  return listExtensionNames(right).every((names, index) => names === before[index]);
}

export function resolveDeferredInstructions(
  extensions: Pick<SessionExtensions, 'deferred' | 'deferredSkills'>
) {
  const { deferred, deferredSkills } = extensions;
  if (deferred.length === 0 && deferredSkills.length === 0) return null;
  const lines = [
    '## Left out until needed',
    'Shinsa left out what agents have not used lately, to keep your context small. You can still use all of it.',
  ];
  if (deferred.length > 0) {
    lines.push(
      `- MCP servers: ${deferred.map(describeServerChoice).join(', ')}. Load one with \`load_mcp_server\`.`
    );
  }
  if (deferredSkills.length > 0) {
    lines.push('- Skills: the ones `load_skill` lists. Read one with `load_skill`.');
  }
  lines.push(
    'When the human names a server or a skill you do not have, in any form (`maple`, “the Maple MCP”), load it with `load_mcp_server` or `load_skill` and use it. Never say it is not available before you tried to load it.'
  );
  return lines.join('\n');
}

export function createSessionLoader(extensions: SessionExtensions, open: OpenClient | undefined) {
  if (extensions.deferred.length === 0 && extensions.deferredSkills.length === 0) return null;
  return new ExtensionLoader(
    {
      deferred: extensions.deferred,
      deferredSkills: extensions.deferredSkills,
      loadedNames: extensions.servers.flatMap((server) => [server.name, server.claudeName]),
    },
    open
  );
}
