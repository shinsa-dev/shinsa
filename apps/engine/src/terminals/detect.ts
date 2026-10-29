import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { SERVICE_PORT_VARIABLE, type ServiceSource, type ServiceSuggestion } from '@shinsa/core';

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
  ['npm-shrinkwrap.json', 'npm'],
];

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml'];

const DENO_FILES = ['deno.json', 'deno.jsonc'];

const RUN_SCRIPTS = ['dev', 'start', 'serve'];

const MAKE_TARGETS = ['dev', 'run', 'serve', 'start'];

const CONVENTIONAL_WORKSPACES = ['apps/*', 'packages/*', 'services/*'];

const LIBRARY_FOLDERS = new Set(['packages', 'libs', 'lib']);

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

function listFolders(parent: string) {
  if (!isFolder(parent)) return [];
  return readdirSync(parent)
    .sort()
    .filter((entry) => !SKIPPED_FOLDERS.has(entry) && isFolder(join(parent, entry)));
}

function readStrings(value: unknown) {
  return Array.isArray(value) ? value.filter((each): each is string => typeof each === 'string') : [];
}

function readWorkspaces(value: unknown) {
  if (Array.isArray(value)) return readStrings(value);
  if (value && typeof value === 'object') return readStrings((value as { packages?: unknown }).packages);
  return [];
}

function readStringRecord(value: unknown) {
  const record: Record<string, string> = {};
  if (!value || typeof value !== 'object') return record;
  for (const [key, each] of Object.entries(value)) if (typeof each === 'string') record[key] = each;
  return record;
}

function parseJsonObject(text: string | null) {
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parsePackageFile(text: string | null): PackageFile | null {
  const fields = parseJsonObject(text);
  if (!fields) return null;
  return {
    name: typeof fields.name === 'string' ? fields.name : null,
    scripts: readStringRecord(fields.scripts),
    workspaces: readWorkspaces(fields.workspaces),
    packageManager: typeof fields.packageManager === 'string' ? fields.packageManager : null,
  };
}

export function parseDenoTasks(text: string | null) {
  const fields = parseJsonObject(text);
  return fields ? readStringRecord(fields.tasks) : {};
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

export function parseComposeServices(text: string | null) {
  if (text === null) return [];
  const names: string[] = [];
  let indent: string | null = null;
  let inServices = false;
  for (const line of text.split('\n')) {
    if (/^services\s*:\s*(?:#.*)?$/.test(line)) {
      inServices = true;
      continue;
    }
    if (/^\S/.test(line)) inServices = false;
    const entry = inServices ? /^(\s+)([A-Za-z0-9._-]+)\s*:\s*(?:#.*)?$/.exec(line) : null;
    if (!(entry?.[1] && entry[2])) continue;
    indent ??= entry[1];
    if (entry[1] === indent) names.push(entry[2]);
  }
  return names;
}

export function parseMakeTarget(text: string | null) {
  if (text === null) return null;
  const targets = new Set(
    text.split('\n').flatMap((line) => {
      const match = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(line);
      return match?.[1] ? [match[1]] : [];
    })
  );
  return MAKE_TARGETS.find((target) => targets.has(target)) ?? null;
}

export function parseCargoName(text: string | null) {
  if (text === null || /^\[workspace\]/m.test(text)) return null;
  const section = /^\[package\]([\s\S]*?)(?:^\[|$(?![\s\S]))/m.exec(text)?.[1] ?? '';
  return /^\s*name\s*=\s*"([^"]+)"/m.exec(section)?.[1] ?? '';
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
    for (const entry of listFolders(parent)) folders.push(join(parent, entry));
  }
  return [...new Set(folders)];
}

function resolveServiceName(file: PackageFile | null, folder: string) {
  const named = file?.name?.split('/').pop()?.trim();
  return named || basename(folder);
}

function resolveRunScript(file: PackageFile) {
  return RUN_SCRIPTS.find((script) => file.scripts[script]) ?? null;
}

function isLibraryFolder(root: string, folder: string) {
  return LIBRARY_FOLDERS.has(relative(root, folder).split('/')[0] ?? '');
}

function createSuggestion(
  name: string,
  cwd: string,
  command: string,
  source: ServiceSource,
  recommended = true
): ServiceSuggestion {
  return { name, cwd, command, source, recommended, previewUrl: null, portVariable: SERVICE_PORT_VARIABLE };
}

function listWorkspacePatterns(root: string, file: PackageFile) {
  const declared = [...file.workspaces, ...parsePnpmWorkspaces(readText(join(root, 'pnpm-workspace.yaml')))];
  return declared.length > 0 ? declared : CONVENTIONAL_WORKSPACES;
}

function listPackageSuggestions(root: string): ServiceSuggestion[] {
  const file = parsePackageFile(readText(join(root, 'package.json')));
  if (!file) return [];
  const manager = resolvePackageManager(root, file);
  const suggestions: ServiceSuggestion[] = [];
  for (const folder of expandWorkspaces(root, listWorkspacePatterns(root, file))) {
    const workspace = parsePackageFile(readText(join(folder, 'package.json')));
    const script = workspace ? resolveRunScript(workspace) : null;
    if (!script) continue;
    suggestions.push(
      createSuggestion(
        resolveServiceName(workspace, folder),
        folder,
        `${manager} run ${script}`,
        'package',
        !isLibraryFolder(root, folder)
      )
    );
  }
  const script = resolveRunScript(file);
  if (!script) return suggestions;
  const whole = suggestions.length > 0;
  return [
    ...suggestions,
    createSuggestion(
      whole ? 'all' : resolveServiceName(file, root),
      root,
      `${manager} run ${script}`,
      'package',
      !whole
    ),
  ];
}

function listDenoSuggestions(root: string): ServiceSuggestion[] {
  if (existsSync(join(root, 'package.json'))) return [];
  const file = DENO_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return [];
  const tasks = parseDenoTasks(readText(join(root, file)));
  const task = RUN_SCRIPTS.find((name) => tasks[name]);
  return task ? [createSuggestion(basename(root), root, `deno task ${task}`, 'deno')] : [];
}

function listProcfileSuggestions(root: string): ServiceSuggestion[] {
  if (existsSync(join(root, 'bin/dev'))) return [createSuggestion(basename(root), root, 'bin/dev', 'script')];
  const file = ['Procfile.dev', 'Procfile'].find((name) => existsSync(join(root, name))) ?? 'Procfile';
  return parseProcfile(readText(join(root, file))).map(({ name, command }) =>
    createSuggestion(name, root, command, 'procfile')
  );
}

function listComposeSuggestions(root: string): ServiceSuggestion[] {
  const file = COMPOSE_FILES.find((name) => existsSync(join(root, name)));
  if (!file) return [];
  const services = parseComposeServices(readText(join(root, file)));
  if (services.length === 0) return [createSuggestion('compose', root, 'docker compose up', 'compose')];
  return services.map((name) => createSuggestion(name, root, `docker compose up ${name}`, 'compose'));
}

function listCargoSuggestions(root: string): ServiceSuggestion[] {
  if (!existsSync(join(root, 'src/main.rs'))) return [];
  const name = parseCargoName(readText(join(root, 'Cargo.toml')));
  return name === null ? [] : [createSuggestion(name || basename(root), root, 'cargo run', 'cargo')];
}

function listGoSuggestions(root: string): ServiceSuggestion[] {
  if (!existsSync(join(root, 'go.mod'))) return [];
  const commands = listFolders(join(root, 'cmd'))
    .filter((entry) => existsSync(join(root, 'cmd', entry, 'main.go')))
    .map((entry) => createSuggestion(entry, root, `go run ./cmd/${entry}`, 'go'));
  if (existsSync(join(root, 'main.go')))
    return [createSuggestion(basename(root), root, 'go run .', 'go'), ...commands];
  return commands;
}

function listDjangoSuggestions(root: string): ServiceSuggestion[] {
  if (!existsSync(join(root, 'manage.py'))) return [];
  return [createSuggestion(basename(root), root, 'python manage.py runserver', 'django')];
}

function listMakeSuggestions(root: string): ServiceSuggestion[] {
  const target = parseMakeTarget(readText(join(root, 'Makefile')));
  return target ? [createSuggestion(basename(root), root, `make ${target}`, 'make')] : [];
}

function listRootSuggestions(root: string): ServiceSuggestion[] {
  const found = [
    ...listPackageSuggestions(root),
    ...listDenoSuggestions(root),
    ...listProcfileSuggestions(root),
    ...listComposeSuggestions(root),
    ...listCargoSuggestions(root),
    ...listGoSuggestions(root),
    ...listDjangoSuggestions(root),
  ];
  return found.length > 0 ? found : listMakeSuggestions(root);
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
  return resolveUniqueNames(roots.flatMap(listRootSuggestions), roots).slice(0, SUGGESTION_LIMIT);
}
