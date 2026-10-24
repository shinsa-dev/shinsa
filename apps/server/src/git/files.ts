import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import {
  CODE_LIMITS,
  DomainError,
  type FileContent,
  isCommitSha,
  type RepoEntry,
  type RepoEntryKind,
  type RepoPaths,
  type RepoTree,
  resolveImageType,
  type SearchMatch,
  type SearchResult,
  WORKING_REF,
} from '@shinsa/core';
import type { ObjectCache } from './objects.ts';
import { decodeText, type GitRead, readGit, splitRecords } from './read.ts';

export interface SearchQuery {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  glob: string | null;
}

const LIST_BYTES = 64 * 1024 * 1024;

const SEARCH_BYTES = 4 * 1024 * 1024;

const MATCH_TEXT = 500;

const BINARY_SNIFF_BYTES = 8000;

const ENTRY_KIND: Record<string, RepoEntryKind> = { blob: 'file', tree: 'directory', commit: 'submodule' };

const SYMLINK_MODE = '120000';

function assertRead(read: GitRead, what: string) {
  if (read.ok) return read;
  if (read.timedOut) throw new DomainError('read_timeout', `Reading ${what} took too long and was stopped.`);
  throw new DomainError(
    'read_failed',
    `Shinsa could not read ${what}: ${read.stderr || `exit ${read.code}`}`
  );
}

export async function assertCommit(repoPath: string, sha: string, signal?: AbortSignal) {
  if (!isCommitSha(sha))
    throw new DomainError(
      'ref_invalid',
      `Name a commit by its full id, or “${WORKING_REF}” for the working copy.`
    );
  const read = await readGit(['cat-file', '-t', sha], repoPath, { signal });
  if (!read.ok || decodeText(read.bytes).trim() !== 'commit')
    throw new DomainError('ref_unknown', 'The repository has no such commit.');
  return sha;
}

function capPaths(paths: string[], ref: string): RepoPaths {
  return {
    ref,
    paths: paths.slice(0, CODE_LIMITS.paths),
    truncated: paths.length > CODE_LIMITS.paths,
  };
}

export async function listCommitPaths(repoPath: string, sha: string, signal?: AbortSignal) {
  const read = assertRead(
    await readGit(['ls-tree', '-r', '-z', '--name-only', '--full-tree', sha], repoPath, {
      signal,
      maxBytes: LIST_BYTES,
    }),
    'the files'
  );
  const paths = splitRecords(read.bytes);
  return capPaths(read.truncated ? paths.slice(0, -1) : paths, sha);
}

export async function listWorkingPaths(worktree: string, signal?: AbortSignal) {
  const [listed, deleted] = await Promise.all([
    readGit(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], worktree, {
      signal,
      maxBytes: LIST_BYTES,
    }),
    readGit(['ls-files', '-z', '--deleted'], worktree, { signal, maxBytes: LIST_BYTES }),
  ]);
  const gone = new Set(splitRecords(assertRead(deleted, 'the files').bytes));
  const paths = [...new Set(splitRecords(assertRead(listed, 'the files').bytes))].filter(
    (path) => !gone.has(path)
  );
  return capPaths(paths.sort(), WORKING_REF);
}

function sortEntries(entries: RepoEntry[]) {
  return entries.sort(
    (a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name)
  );
}

interface TreeRecord {
  entry: RepoEntry;
  object: string;
}

function parseTreeRecord(record: string): TreeRecord | null {
  const tab = record.indexOf('\t');
  const [mode = '', type = '', object = '', size = '-'] = record.slice(0, tab).split(/\s+/);
  const path = record.slice(tab + 1);
  const kind = mode === SYMLINK_MODE ? 'symlink' : ENTRY_KIND[type];
  if (tab < 0 || !kind) return null;
  const entry = {
    name: path.slice(path.lastIndexOf('/') + 1),
    path,
    kind,
    size: size === '-' ? null : Number(size),
  };
  return { entry, object };
}

function listTreeRecords(read: GitRead) {
  return splitRecords(read.bytes)
    .map(parseTreeRecord)
    .filter((record): record is TreeRecord => record !== null);
}

export async function listCommitTree(
  repoPath: string,
  sha: string,
  dir: string,
  signal?: AbortSignal
): Promise<RepoTree> {
  const args = ['ls-tree', '-z', '--long', '--full-tree', sha, ...(dir ? ['--', `${dir}/`] : [])];
  const read = assertRead(await readGit(args, repoPath, { signal, maxBytes: LIST_BYTES }), 'the folder');
  return { ref: sha, dir, entries: sortEntries(listTreeRecords(read).map((record) => record.entry)) };
}

export function listWorkingTree(paths: RepoPaths, dir: string): RepoTree {
  const prefix = dir ? `${dir}/` : '';
  const entries = new Map<string, RepoEntry>();
  for (const path of paths.paths) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    const name = slash < 0 ? rest : rest.slice(0, slash);
    if (entries.has(name)) continue;
    entries.set(name, {
      name,
      path: `${prefix}${name}`,
      kind: slash < 0 ? 'file' : 'directory',
      size: null,
    });
  }
  return { ref: paths.ref, dir, entries: sortEntries([...entries.values()]) };
}

function isBinary(bytes: Uint8Array) {
  return bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

function describeBytes(ref: string, path: string, bytes: Uint8Array, size: number): FileContent {
  const binary = isBinary(bytes);
  return {
    ref,
    path,
    content: binary ? null : decodeText(bytes),
    size,
    binary,
    tooLarge: false,
    missing: false,
    image: binary ? resolveImageType(path) : null,
  };
}

function describeAbsent(ref: string, path: string, size: number, tooLarge: boolean): FileContent {
  return {
    ref,
    path,
    content: null,
    size,
    binary: false,
    tooLarge,
    missing: !tooLarge,
    image: tooLarge ? resolveImageType(path) : null,
  };
}

async function selectBlob(repoPath: string, sha: string, path: string, signal?: AbortSignal) {
  const read = assertRead(
    await readGit(['ls-tree', '-z', '--long', '--full-tree', sha, '--', path], repoPath, { signal }),
    path
  );
  const record = listTreeRecords(read).find((candidate) => candidate.entry.path === path);
  if (!record || (record.entry.kind !== 'file' && record.entry.kind !== 'symlink')) return null;
  return { object: record.object, size: record.entry.size ?? 0 };
}

async function readObject(repoPath: string, object: string, signal?: AbortSignal) {
  const read = await readGit(['cat-file', 'blob', object], repoPath, {
    signal,
    maxBytes: CODE_LIMITS.blobBytes,
  });
  return assertRead(read, 'the file').bytes;
}

export async function readCommitFile(
  repoPath: string,
  sha: string,
  path: string,
  cache: ObjectCache,
  signal?: AbortSignal
): Promise<FileContent> {
  const blob = await selectBlob(repoPath, sha, path, signal);
  if (!blob) return describeAbsent(sha, path, 0, false);
  if (blob.size > CODE_LIMITS.blobBytes) return describeAbsent(sha, path, blob.size, true);
  const bytes = await cache.read(
    `${repoPath}\0blob\0${blob.object}`,
    () => readObject(repoPath, blob.object, signal),
    (value) => value.length
  );
  return describeBytes(sha, path, bytes, blob.size);
}

export async function readCommitBytes(repoPath: string, sha: string, path: string, signal?: AbortSignal) {
  const blob = await selectBlob(repoPath, sha, path, signal);
  if (!blob || blob.size > CODE_LIMITS.blobBytes) return null;
  return readObject(repoPath, blob.object, signal);
}

function statPath(absolute: string) {
  try {
    return lstatSync(absolute);
  } catch {
    return null;
  }
}

export function readWorkingBytes(absolute: string) {
  const stat = statPath(absolute);
  if (!stat?.isFile() || stat.size > CODE_LIMITS.blobBytes) return null;
  return new Uint8Array(readFileSync(absolute));
}

export function readWorkingFile(absolute: string, path: string): FileContent {
  const stat = statPath(absolute);
  if (stat?.isSymbolicLink()) {
    const target = new TextEncoder().encode(readlinkSync(absolute));
    return describeBytes(WORKING_REF, path, target, target.length);
  }
  if (!stat?.isFile()) return describeAbsent(WORKING_REF, path, 0, false);
  if (stat.size > CODE_LIMITS.blobBytes) return describeAbsent(WORKING_REF, path, stat.size, true);
  return describeBytes(WORKING_REF, path, new Uint8Array(readFileSync(absolute)), stat.size);
}

function resolvePathspec(glob: string | null) {
  if (!glob) return [];
  return [`:(glob)${glob.includes('/') ? glob : `**/${glob}`}`];
}

function parseMatch(record: string, sha: string | null): SearchMatch | null {
  const [location = '', line = '', column = '', ...rest] = record.split('\0');
  const path = sha && location.startsWith(`${sha}:`) ? location.slice(sha.length + 1) : location;
  const number = Number(line);
  if (!path || !Number.isInteger(number) || number < 1) return null;
  return { path, line: number, column: Number(column) || 1, text: rest.join('\0').slice(0, MATCH_TEXT) };
}

export async function searchFiles(
  cwd: string,
  sha: string | null,
  search: SearchQuery,
  signal?: AbortSignal
): Promise<SearchResult> {
  const args = [
    'grep',
    '-n',
    '-I',
    '--column',
    '-z',
    '--no-color',
    '--full-name',
    search.caseSensitive ? '--no-ignore-case' : '-i',
    search.regex ? '-E' : '-F',
    '-e',
    search.query,
    ...(sha ? [sha] : ['--untracked']),
    '--',
    ...resolvePathspec(search.glob),
  ];
  const read = await readGit(args, cwd, { signal, literal: false, maxBytes: SEARCH_BYTES });
  if (!read.ok && !read.timedOut && read.code !== 1) assertRead(read, 'the search');
  const lines = decodeText(read.bytes).split('\n');
  if (read.timedOut || read.truncated) lines.pop();
  const matches = lines
    .map((record) => parseMatch(record, sha))
    .filter((match): match is SearchMatch => match !== null);
  return {
    ref: sha ?? WORKING_REF,
    matches: matches.slice(0, CODE_LIMITS.matches),
    truncated: read.truncated || matches.length > CODE_LIMITS.matches,
    timedOut: read.timedOut,
  };
}
