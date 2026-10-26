import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { ServiceSuggestion } from '@shinsa/core';

interface PackageFile {
  name: string | null;
  scripts: Record<string, string>;
  workspaces: string[];
  packageManager: string | null;
}

type PackageManager = 'bun' | 'pnpm' | 'yarn' | 'npm';

const LOCKFILES: [string, PackageManager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
];

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

const DEV_SCRIPT = 'dev';

const SUGGESTION_LIMIT = 24;

const SKIPPED_FOLDERS = new Set(['node_modules', '.git']);

function readText(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function isFolder(path: string) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
}

function readWorkspaces(value: unknown) {
  if (Array.isArray(value)) return readStrings(value);
  if (value && typeof value === 'object') return readStrings((value as { packages?: unknown }).packages);
  return [];
}

export function parsePackageFile(text: string | null): PackageFile | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const fields = parsed as Record<string, unknown>;
  const scripts: Record<string, string> = {};
  if (fields.scripts && typeof fields.scripts === 'object') {
    for (const [key, value] of Object.entries(fields.scripts))
      if (typeof value === 'string') scripts[key] = value;
  }
  return {
    name: typeof fields.name === 'string' ? fields.name : null,
    scripts,
    workspaces: readWorkspaces(fields.workspaces),
    packageManager: typeof fields.packageManager === 'string' ? fields.packageManager : null,
  };
}

export function parsePnpmWorkspaces(text: string | null) {
  if (text === null) return [];
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (/^\S/.test(line)) inPackages = false;
    const item = inPackages ? /^\s+-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(line) : null;
    if (item?.[1]) patterns.push(item[1]);
  }
  return patterns;
}

export function parseProcfile(text: string | null) {
  if (text === null) return [];
  return text.split('\n').flatMap((line) => {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(line.trim());
    return match?.[1] && match[2] ? [{ name: match[1], command: match[2].trim() }] : [];
  });
}

function resolvePackageManager(root: string, file: PackageFile): PackageManager {
  const locked = LOCKFILES.find(([name]) => existsSync(join(root, name)));
  if (locked) return locked[1];
  const named = file.packageManager?.split('@')[0];
  return named === 'bun' || named === 'pnpm' || named === 'yarn' ? named : 'npm';
}

export function expandWorkspaces(root: string, patterns: string[]) {
  const folders: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    const clean = pattern.replace(/\/+$/, '').replace(/^\.\//, '');
    const star = clean.match(/^(.*?)\/\*{1,2}$/);
    if (!star) {
      if (isFolder(join(root, clean))) folders.push(join(root, clean));
      continue;
    }
    const parent = join(root, star[1] ?? '');
    if (!isFolder(parent)) continue;
    for (const entry of readdirSync(parent).sort()) {
      const folder = join(parent, entry);
      if (!SKIPPED_FOLDERS.has(entry) && isFolder(folder)) folders.push(folder);
    }
  }
  return [...new Set(folders)];
}

function resolveServiceName(file: PackageFile | null, folder: string) {
  const named = file?.name?.split('/').pop()?.trim();
  return named || basename(folder);
}

function describeScript(manager: PackageManager) {
  return `${manager} run ${DEV_SCRIPT}`;
}

function listPackageSuggestions(root: string): ServiceSuggestion[] {
  const file = parsePackageFile(readText(join(root, 'package.json')));
  if (!file) return [];
  const manager = resolvePackageManager(root, file);
  const patterns = [...file.workspaces, ...parsePnpmWorkspaces(readText(join(root, 'pnpm-workspace.yaml')))];
  const suggestions: ServiceSuggestion[] = [];
  for (const folder of expandWorkspaces(root, patterns)) {
    const workspace = parsePackageFile(readText(join(folder, 'package.json')));
    if (!workspace?.scripts[DEV_SCRIPT]) continue;
    suggestions.push({
      name: resolveServiceName(workspace, folder),
      cwd: folder,
      command: describeScript(manager),
      source: 'package',
    });
  }
  if (file.scripts[DEV_SCRIPT])
    suggestions.push({
      name: suggestions.length > 0 ? 'all' : resolveServiceName(file, root),
      cwd: root,
      command: describeScript(manager),
      source: 'package',
    });
  return suggestions;
}

function listProcfileSuggestions(root: string): ServiceSuggestion[] {
  return parseProcfile(readText(join(root, 'Procfile'))).map(({ name, command }) => ({
    name,
    cwd: root,
    command,
    source: 'procfile',
  }));
}

function listComposeSuggestions(root: string): ServiceSuggestion[] {
  if (!COMPOSE_FILES.some((name) => existsSync(join(root, name)))) return [];
  return [{ name: 'compose', cwd: root, command: 'docker compose up', source: 'compose' }];
}

function resolveUniqueNames(suggestions: ServiceSuggestion[], roots: string[]) {
  const counts = new Map<string, number>();
  for (const each of suggestions) counts.set(each.name, (counts.get(each.name) ?? 0) + 1);
  return suggestions.map((each) => {
    if ((counts.get(each.name) ?? 0) < 2) return each;
    const root = roots.find((path) => each.cwd === path || each.cwd.startsWith(`${path}/`)) ?? each.cwd;
    const where = relative(root, each.cwd);
    return { ...each, name: where || `${basename(root)}-${each.name}` };
  });
}

export function listServiceSuggestions(roots: string[]): ServiceSuggestion[] {
  const suggestions = roots.flatMap((root) => [
    ...listPackageSuggestions(root),
    ...listProcfileSuggestions(root),
    ...listComposeSuggestions(root),
  ]);
  return resolveUniqueNames(suggestions, roots).slice(0, SUGGESTION_LIMIT);
}
