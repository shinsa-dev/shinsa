import { CODE_LIMITS, type FileContent, type RepoTree, type SearchMatch } from '@shinsa/core';
import { edgeRuntime } from '../runtime/edge.ts';
import type { ObjectCache } from './objects.ts';
import { runCodeRead } from './tree/edge.ts';
import { describeAbsent, describeBytes } from './tree/entries.ts';
import type { BatchReader, SearchQuery } from './tree/schema.ts';
import { CodeFiles } from './tree/service.ts';

export { listWorkingTree, parseTreeObject, resolveGrepPattern } from './tree/entries.ts';
export type { SearchQuery } from './tree/schema.ts';

export function assertCommit(repoPath: string, sha: string, signal?: AbortSignal) {
  return runCodeRead(CodeFiles.use((files) => files.assertCommit(repoPath, sha, signal)));
}

export function listCommitPaths(repoPath: string, sha: string, signal?: AbortSignal) {
  return runCodeRead(CodeFiles.use((files) => files.listCommitPaths(repoPath, sha, signal)));
}

export function listWorkingPaths(worktree: string, signal?: AbortSignal) {
  return runCodeRead(CodeFiles.use((files) => files.listWorkingPaths(worktree, signal)));
}

export function listCommitTree(
  repoPath: string,
  sha: string,
  dir: string,
  signal?: AbortSignal,
  reader?: BatchReader
): Promise<RepoTree> {
  return runCodeRead(CodeFiles.use((files) => files.listCommitTree(repoPath, sha, dir, signal, reader)));
}

export async function readCommitFile(
  repoPath: string,
  sha: string,
  path: string,
  cache: ObjectCache,
  signal?: AbortSignal,
  reader?: BatchReader
): Promise<FileContent> {
  const blob = await runCodeRead(
    CodeFiles.use((files) => files.selectBlob(repoPath, sha, path, signal, reader))
  );
  if (!blob) return describeAbsent(sha, path, 0, false);
  if (blob.size > CODE_LIMITS.blobBytes) return describeAbsent(sha, path, blob.size, true);
  const bytes = await cache.read(
    `${repoPath}\0blob\0${blob.object}`,
    () => runCodeRead(CodeFiles.use((files) => files.readObject(repoPath, blob.object, signal, reader))),
    (value) => value.length
  );
  return describeBytes(sha, path, bytes, blob.size);
}

export async function readCommitBytes(
  repoPath: string,
  sha: string,
  path: string,
  signal?: AbortSignal,
  reader?: BatchReader
) {
  const blob = await runCodeRead(
    CodeFiles.use((files) => files.selectBlob(repoPath, sha, path, signal, reader))
  );
  if (!blob || blob.size > CODE_LIMITS.blobBytes) return null;
  return runCodeRead(CodeFiles.use((files) => files.readObject(repoPath, blob.object, signal, reader)));
}

export function readWorkingBytes(absolute: string) {
  return edgeRuntime.runSync(CodeFiles.use((files) => files.readWorkingBytes(absolute)));
}

export function readWorkingFile(absolute: string, path: string): FileContent {
  return edgeRuntime.runSync(CodeFiles.use((files) => files.readWorkingFile(absolute, path)));
}

export function searchFiles(
  cwd: string,
  sha: string | null,
  search: SearchQuery,
  signal?: AbortSignal,
  onMatches?: (matches: SearchMatch[]) => void
) {
  return runCodeRead(CodeFiles.use((files) => files.search(cwd, sha, search, signal, onMatches)));
}
