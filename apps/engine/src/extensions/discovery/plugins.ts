import { type PluginSummary, resolveDisplayPath } from '@shinsa/core';
import type { ClaudePlugin, PluginFiles, PluginParts } from '../schema.ts';
import { parseFrontmatter, resolveListingTokens } from './skills.ts';

function sumListingTokens(files: readonly { entry: string; text: string }[], prefix: string) {
  return files.reduce((total, file) => {
    const { name, description } = parseFrontmatter(file.text);
    return total + resolveListingTokens(`${prefix}${name ?? file.entry}`, description);
  }, 0);
}

export function serializePluginSummary(
  plugin: ClaudePlugin,
  files: PluginFiles,
  parts: PluginParts,
  enabled: boolean,
  userHome: string
): PluginSummary {
  const prefix = `${plugin.name}:`;
  return {
    id: plugin.id,
    name: plugin.name,
    origin: resolveDisplayPath(plugin.root, userHome),
    enabled,
    skills: parts.skills,
    agents: files.agents.length,
    commands: files.commands.length,
    servers: parts.servers,
    hooks: files.hooks || plugin.manifest?.hooks !== undefined,
    tokens:
      parts.skillTokens + sumListingTokens(files.agents, prefix) + sumListingTokens(files.commands, prefix),
  };
}
