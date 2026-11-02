import { join } from 'node:path';
import { resolveDisplayPath, resolveTokenEstimate } from '@shinsa/core';
import type { ClaudePlugin, DiscoveryPaths, FoundSkill, SkillRoot } from '../schema.ts';

const SKILL_DESCRIPTION_LIMIT = 300;

const LISTED_DESCRIPTION_LIMIT = 1536;

const BLOCK_MARKERS = new Set(['>', '|', '>-', '|-', '>+', '|+']);

function unquote(text: string) {
  const trimmed = text.trim();
  const quoted = /^(["'])([\s\S]*)\1$/.exec(trimmed);
  return quoted ? (quoted[2] ?? '') : trimmed;
}

function readBlock(lines: string[], start: number) {
  const parts: string[] = [];
  for (const line of lines.slice(start)) {
    if (line.trim() && !/^\s/.test(line)) break;
    parts.push(line.trim());
  }
  return parts.join(' ').trim();
}

export function parseFrontmatter(text: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return { name: null, description: '' };
  const lines = (match[1] ?? '').split(/\r?\n/);
  const fields: Record<string, string> = {};
  lines.forEach((line, index) => {
    const field = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (!field) return;
    const [, key = '', value = ''] = field;
    fields[key] = BLOCK_MARKERS.has(value.trim()) ? readBlock(lines, index + 1) : unquote(value);
  });
  return { name: fields.name || null, description: fields.description ?? '' };
}

function clipSkillDescription(text: string) {
  return text.length > SKILL_DESCRIPTION_LIMIT ? `${text.slice(0, SKILL_DESCRIPTION_LIMIT - 1)}…` : text;
}

export function resolveListingTokens(name: string, description: string) {
  return resolveTokenEstimate(`- ${name}: ${description.slice(0, LISTED_DESCRIPTION_LIMIT)}\n`);
}

export function resolveFoundSkill(root: SkillRoot, entry: string, path: string, text: string): FoundSkill {
  const { name, description } = parseFrontmatter(text);
  const skillName = name ?? entry;
  return {
    id: `${root.idPrefix}${entry}`,
    name: skillName,
    description: clipSkillDescription(description),
    source: root.source,
    origin: root.origin,
    plugin: root.plugin,
    repoPath: root.repoPath,
    path,
    claudeName: root.claudePrefix === null ? null : `${root.claudePrefix}${skillName}`,
    tokens: resolveListingTokens(skillName, description),
  };
}

export function listSkillRoots(
  paths: DiscoveryPaths,
  plugins: ClaudePlugin[],
  pluginDir: string
): SkillRoot[] {
  return [
    {
      dir: join(pluginDir, 'skills'),
      source: 'shinsa',
      idPrefix: 'shinsa:',
      origin: 'Shinsa',
      plugin: 'shinsa',
      repoPath: null,
      claudePrefix: 'shinsa:',
    },
    {
      dir: join(paths.claudeDir, 'skills'),
      source: 'user',
      idPrefix: 'user:',
      origin: resolveDisplayPath(join(paths.claudeDir, 'skills'), paths.userHome),
      plugin: null,
      repoPath: null,
      claudePrefix: '',
    },
    ...plugins.map((plugin) => ({
      dir: join(plugin.root, 'skills'),
      source: 'plugin' as const,
      idPrefix: `plugin:${plugin.id}:`,
      origin: `${plugin.name} plugin`,
      plugin: plugin.id,
      repoPath: null,
      claudePrefix: `${plugin.name}:`,
    })),
    ...paths.repos.map((repo) => ({
      dir: join(repo, '.claude', 'skills'),
      source: 'project' as const,
      idPrefix: `project:${repo}:`,
      origin: resolveDisplayPath(join(repo, '.claude', 'skills'), paths.userHome),
      plugin: null,
      repoPath: repo,
      claudePrefix: '',
    })),
    {
      dir: join(paths.codexHome, 'skills'),
      source: 'codex',
      idPrefix: 'codex:',
      origin: resolveDisplayPath(join(paths.codexHome, 'skills'), paths.userHome),
      plugin: null,
      repoPath: null,
      claudePrefix: null,
    },
  ];
}
