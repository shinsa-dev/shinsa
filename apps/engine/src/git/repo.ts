import { basename } from 'node:path';
import type { RepoCandidate } from '@shinsa/core';
import { runCommand, runCommandOrThrow } from '../shell/index.ts';

export function normalizeRemote(url: string) {
  return url
    .replace(/^git@([^:]+):/, '$1/')
    .replace(/^[a-z]+:\/\/(?:[^/@]+@)?/, '')
    .replace(/\.git$/, '');
}

async function resolveLocalDefault(root: string) {
  for (const candidate of ['main', 'master']) {
    const exists = await runCommand(
      ['git', 'show-ref', '--verify', '--quiet', `refs/heads/${candidate}`],
      root
    );
    if (exists.ok) return candidate;
  }
  return runCommandOrThrow(['git', 'branch', '--show-current'], root);
}

export async function resolveRepoRoot(path: string) {
  const result = await runCommand(['git', 'rev-parse', '--show-toplevel'], path);
  return result.ok ? result.stdout : null;
}

export async function resolveRepoRemote(root: string) {
  const remoteUrl = await runCommand(['git', 'remote', 'get-url', 'origin'], root);
  return remoteUrl.ok ? normalizeRemote(remoteUrl.stdout) : null;
}

export async function inspectRepo(path: string): Promise<RepoCandidate> {
  const root = await runCommandOrThrow(['git', 'rev-parse', '--show-toplevel'], path);
  const remote = await resolveRepoRemote(root);
  const remoteHead = await runCommand(['git', 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root);
  let defaultBranch = remoteHead.stdout.replace(/^origin\//, '');
  if (!remoteHead.ok) defaultBranch = await resolveLocalDefault(root);
  return {
    path: root,
    name: basename(root),
    defaultBranch,
    remote,
  };
}
