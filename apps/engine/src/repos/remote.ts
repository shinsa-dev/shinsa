import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { normalizeRemote } from '../git/repo.ts';

const ORIGIN_SECTION = /^\s*\[remote\s+"origin"\]\s*$/;

const SECTION = /^\s*\[/;

const URL_LINE = /^\s*url\s*=\s*(\S+)\s*$/;

function readText(path: string) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

function resolveGitDir(repo: string) {
  const dotGit = join(repo, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
  } catch {
    return null;
  }
  const pointer = /^gitdir:\s*(.+)$/m.exec(readText(dotGit) ?? '')?.[1]?.trim();
  if (!pointer) return null;
  const gitDir = isAbsolute(pointer) ? pointer : resolve(repo, pointer);
  const common = readText(join(gitDir, 'commondir'))?.trim();
  if (!common) return gitDir;
  return isAbsolute(common) ? common : resolve(gitDir, common);
}

function readOriginUrl(config: string) {
  let inOrigin = false;
  for (const line of config.split('\n')) {
    if (SECTION.test(line)) {
      inOrigin = ORIGIN_SECTION.test(line);
      continue;
    }
    const url = inOrigin ? URL_LINE.exec(line)?.[1] : undefined;
    if (url) return url;
  }
  return null;
}

export function readOriginRemote(repo: string) {
  const gitDir = resolveGitDir(repo);
  const config = gitDir ? readText(join(gitDir, 'config')) : null;
  const url = config ? readOriginUrl(config) : null;
  return url ? normalizeRemote(url) : null;
}
