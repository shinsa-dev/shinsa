import { basename, join, relative } from 'node:path';
import {
  SERVICE_PORT_VARIABLE,
  type ServiceDefinition,
  type ServiceSource,
  type ServiceSuggestion,
  type TerminalPlace,
} from '@shinsa/core';
import { Effect, Option } from 'effect';
import { listWorkspacePatterns, parseDenoTasks, parsePackageManifest } from '../files/manifest.ts';
import { isInside } from '../files/paths.ts';
import { findFirstPresent, isFolder, isPresent, listEntries, selectText } from '../files/probe.ts';
import { PACKAGE_MANIFEST } from '../files/schema.ts';
import { listNewServiceSuggestions, listSuggestionRoots } from './places.ts';

export { parseDenoTasks } from '../files/manifest.ts';

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

const readText = (path: string) => Effect.map(selectText(path), Option.getOrNull);

const listFolders = Effect.fn('ServiceDetection.listFolders')(function* (parent: string) {
  if (!(yield* isFolder(parent))) return [];
  const entries = (yield* listEntries(parent)).filter((entry) => !SKIPPED_FOLDERS.has(entry));
  return yield* Effect.filter(entries, (entry) => isFolder(join(parent, entry)));
});

export function parsePackageFile(text: string | null): PackageFile | null {
  const manifest = parsePackageManifest(text);
  if (!manifest) return null;
  return {
    name: manifest.name ?? null,
    scripts: { ...manifest.scripts },
    workspaces: [...listWorkspacePatterns(manifest)],
    packageManager: manifest.packageManager ?? null,
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

const resolvePackageManager = Effect.fn('ServiceDetection.resolvePackageManager')(function* (
  root: string,
  file: PackageFile
) {
  for (const [name, manager] of LOCKFILES) if (yield* isPresent(join(root, name))) return manager;
  const named = file.packageManager?.split('@')[0];
  const manager: PackageManager = named === 'bun' || named === 'pnpm' || named === 'yarn' ? named : 'npm';
  return manager;
});

export const expandWorkspaces = Effect.fn('ServiceDetection.expandWorkspaces')(function* (
  root: string,
  patterns: string[]
) {
  const folders: string[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    const clean = pattern.replace(/\/+$/, '').replace(/^\.\//, '');
    const star = clean.match(/^(.*?)\/\*{1,2}$/);
    if (!star) {
      if (yield* isFolder(join(root, clean))) folders.push(join(root, clean));
      continue;
    }
    const parent = join(root, star[1] ?? '');
    for (const entry of yield* listFolders(parent)) folders.push(join(parent, entry));
  }
  return [...new Set(folders)];
});

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

const listDeclaredWorkspaces = Effect.fn('ServiceDetection.listDeclaredWorkspaces')(function* (
  root: string,
  file: PackageFile
) {
  const pnpm = parsePnpmWorkspaces(yield* readText(join(root, 'pnpm-workspace.yaml')));
  const declared = [...file.workspaces, ...pnpm];
  return declared.length > 0 ? declared : CONVENTIONAL_WORKSPACES;
});

const listPackageSuggestions = Effect.fn('ServiceDetection.listPackageSuggestions')(function* (root: string) {
  const file = parsePackageFile(yield* readText(join(root, PACKAGE_MANIFEST)));
  if (!file) return [];
  const manager = yield* resolvePackageManager(root, file);
  const suggestions: ServiceSuggestion[] = [];
  for (const folder of yield* expandWorkspaces(root, yield* listDeclaredWorkspaces(root, file))) {
    const workspace = parsePackageFile(yield* readText(join(folder, PACKAGE_MANIFEST)));
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
});

const listDenoSuggestions = Effect.fn('ServiceDetection.listDenoSuggestions')(function* (root: string) {
  if (yield* isPresent(join(root, PACKAGE_MANIFEST))) return [];
  const file = yield* findFirstPresent(DENO_FILES.map((name) => join(root, name)));
  if (Option.isNone(file)) return [];
  const tasks = parseDenoTasks(yield* readText(file.value));
  const task = RUN_SCRIPTS.find((name) => tasks[name]);
  return task ? [createSuggestion(basename(root), root, `deno task ${task}`, 'deno')] : [];
});

const listProcfileSuggestions = Effect.fn('ServiceDetection.listProcfileSuggestions')(function* (
  root: string
) {
  if (yield* isPresent(join(root, 'bin/dev')))
    return [createSuggestion(basename(root), root, 'bin/dev', 'script')];
  const file = yield* findFirstPresent(['Procfile.dev', 'Procfile'].map((name) => join(root, name)));
  const text = yield* readText(Option.getOrElse(file, () => join(root, 'Procfile')));
  return parseProcfile(text).map(({ name, command }) => createSuggestion(name, root, command, 'procfile'));
});

const listComposeSuggestions = Effect.fn('ServiceDetection.listComposeSuggestions')(function* (root: string) {
  const file = yield* findFirstPresent(COMPOSE_FILES.map((name) => join(root, name)));
  if (Option.isNone(file)) return [];
  const services = parseComposeServices(yield* readText(file.value));
  if (services.length === 0) return [createSuggestion('compose', root, 'docker compose up', 'compose')];
  return services.map((name) => createSuggestion(name, root, `docker compose up ${name}`, 'compose'));
});

const listCargoSuggestions = Effect.fn('ServiceDetection.listCargoSuggestions')(function* (root: string) {
  if (!(yield* isPresent(join(root, 'src/main.rs')))) return [];
  const name = parseCargoName(yield* readText(join(root, 'Cargo.toml')));
  return name === null ? [] : [createSuggestion(name || basename(root), root, 'cargo run', 'cargo')];
});

const listGoSuggestions = Effect.fn('ServiceDetection.listGoSuggestions')(function* (root: string) {
  if (!(yield* isPresent(join(root, 'go.mod')))) return [];
  const entries = yield* listFolders(join(root, 'cmd'));
  const commands = (yield* Effect.filter(entries, (entry) =>
    isPresent(join(root, 'cmd', entry, 'main.go'))
  )).map((entry) => createSuggestion(entry, root, `go run ./cmd/${entry}`, 'go'));
  if (yield* isPresent(join(root, 'main.go')))
    return [createSuggestion(basename(root), root, 'go run .', 'go'), ...commands];
  return commands;
});

const listDjangoSuggestions = Effect.fn('ServiceDetection.listDjangoSuggestions')(function* (root: string) {
  if (!(yield* isPresent(join(root, 'manage.py')))) return [];
  return [createSuggestion(basename(root), root, 'python manage.py runserver', 'django')];
});

const listMakeSuggestions = Effect.fn('ServiceDetection.listMakeSuggestions')(function* (root: string) {
  const target = parseMakeTarget(yield* readText(join(root, 'Makefile')));
  return target ? [createSuggestion(basename(root), root, `make ${target}`, 'make')] : [];
});

const listRootSuggestions = Effect.fn('ServiceDetection.listRootSuggestions')(function* (root: string) {
  const found = (yield* Effect.all([
    listPackageSuggestions(root),
    listDenoSuggestions(root),
    listProcfileSuggestions(root),
    listComposeSuggestions(root),
    listCargoSuggestions(root),
    listGoSuggestions(root),
    listDjangoSuggestions(root),
  ])).flat();
  if (found.length > 0) return found;
  return yield* listMakeSuggestions(root);
});

function resolveUniqueNames(suggestions: ServiceSuggestion[], roots: string[]) {
  const counts = new Map<string, number>();
  for (const each of suggestions) counts.set(each.name, (counts.get(each.name) ?? 0) + 1);
  return suggestions.map((each) => {
    if ((counts.get(each.name) ?? 0) < 2) return each;
    const root = roots.find((path) => isInside(path, each.cwd)) ?? each.cwd;
    const where = relative(root, each.cwd);
    return { ...each, name: where || `${basename(root)}-${each.name}` };
  });
}

export const listServiceSuggestions = Effect.fn('ServiceDetection.listServiceSuggestions')(function* (
  roots: string[]
) {
  const found = (yield* Effect.forEach(roots, listRootSuggestions)).flat();
  return resolveUniqueNames(found, roots).slice(0, SUGGESTION_LIMIT);
});

export const listNewSuggestions = Effect.fn('ServiceDetection.listNewSuggestions')(function* (
  places: TerminalPlace[],
  services: ServiceDefinition[]
) {
  return listNewServiceSuggestions(yield* listServiceSuggestions(listSuggestionRoots(places)), services);
});
