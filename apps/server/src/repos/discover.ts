import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

interface RootCandidate {
  path: string;
  repoCount: number;
  repos: string[];
}

export interface Discovery {
  candidates: RootCandidate[];
  truncated: boolean;
}

export interface DiscoveryOptions {
  maxDepth?: number;
  maxDirs?: number;
}

const MAX_DEPTH = 4;

const MAX_DIRS = 20_000;

const SAMPLE_REPOS = 8;

const SKIPPED_DIRS = new Set([
  'node_modules',
  'Library',
  'Applications',
  'Caches',
  'cache',
  'Cache',
  'vendor',
  'Pods',
  'DerivedData',
  'build',
  'dist',
  'target',
  'venv',
  'go',
  'Movies',
  'Music',
  'Pictures',
]);

function isSkipped(name: string) {
  return name.startsWith('.') || SKIPPED_DIRS.has(name);
}

async function readEntries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isRepo(entries: Dirent[]) {
  return entries.some((entry) => entry.name === '.git' && (entry.isDirectory() || entry.isFile()));
}

export async function discoverRoots(home: string, options: DiscoveryOptions = {}): Promise<Discovery> {
  const maxDepth = options.maxDepth ?? MAX_DEPTH;
  const maxDirs = options.maxDirs ?? MAX_DIRS;
  const parents = new Map<string, string[]>();
  let queue = [home];
  let visited = 0;
  let truncated = false;
  for (let depth = 0; depth <= maxDepth && queue.length > 0; depth += 1) {
    const next: string[] = [];
    for (const dir of queue) {
      if (visited >= maxDirs) {
        truncated = true;
        break;
      }
      visited += 1;
      const entries = await readEntries(dir);
      if (dir !== home && isRepo(entries)) {
        const parent = dirname(dir);
        parents.set(parent, [...(parents.get(parent) ?? []), basename(dir)]);
        continue;
      }
      if (depth === maxDepth) continue;
      for (const entry of entries) {
        if (entry.isDirectory() && !isSkipped(entry.name)) next.push(join(dir, entry.name));
      }
    }
    queue = next;
  }
  const candidates = [...parents.entries()]
    .map(([path, repos]) => ({
      path,
      repoCount: repos.length,
      repos: repos.sort((a, b) => a.localeCompare(b)).slice(0, SAMPLE_REPOS),
    }))
    .sort((a, b) => b.repoCount - a.repoCount || a.path.localeCompare(b.path));
  return { candidates, truncated };
}
