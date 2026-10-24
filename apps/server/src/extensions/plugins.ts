import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PluginSummary, resolveDisplayPath } from '@shinsa/core';
import { isFields } from './definitions.ts';
import type { ClaudePlugin } from './discover.ts';
import { parseFrontmatter, resolveListingTokens } from './skills.ts';

interface PluginParts {
  skills: number;
  servers: number;
  skillTokens: number;
}

function listMarkdown(dir: string) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('.'))
    .sort()
    .map((entry) => ({ entry: entry.slice(0, -3), text: readFileSync(join(dir, entry), 'utf8') }));
}

function sumListingTokens(files: { entry: string; text: string }[], prefix: string) {
  return files.reduce((total, file) => {
    const { name, description } = parseFrontmatter(file.text);
    return total + resolveListingTokens(`${prefix}${name ?? file.entry}`, description);
  }, 0);
}

function hasHooks(plugin: ClaudePlugin) {
  if (existsSync(join(plugin.root, 'hooks', 'hooks.json'))) return true;
  return isFields(plugin.manifest) && plugin.manifest.hooks !== undefined;
}

export function resolvePluginSummary(
  plugin: ClaudePlugin,
  parts: PluginParts,
  enabled: boolean,
  userHome: string
): PluginSummary {
  const agents = listMarkdown(join(plugin.root, 'agents'));
  const commands = listMarkdown(join(plugin.root, 'commands'));
  const prefix = `${plugin.name}:`;
  return {
    id: plugin.id,
    name: plugin.name,
    origin: resolveDisplayPath(plugin.root, userHome),
    enabled,
    skills: parts.skills,
    agents: agents.length,
    commands: commands.length,
    servers: parts.servers,
    hooks: hasHooks(plugin),
    tokens: parts.skillTokens + sumListingTokens(agents, prefix) + sumListingTokens(commands, prefix),
  };
}
