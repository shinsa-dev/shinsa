import {
  CODE_LIMITS,
  type FileContent,
  type RepoEntry,
  type RepoPaths,
  type RepoTree,
  resolveImageType,
  type SearchMatch,
} from '@shinsa/core';
import { Option } from 'effect';
import { decodeText, splitRecords } from '../text.ts';
import {
  BINARY_SNIFF_BYTES,
  ENTRY_KIND,
  ERE_SPECIAL,
  MATCH_TEXT,
  type SearchQuery,
  SYMLINK_MODE,
  TREE_MODES,
  type TreeRecord,
} from './schema.ts';

export function capPaths(paths: string[], ref: string): RepoPaths {
  return { ref, paths: paths.slice(0, CODE_LIMITS.paths), truncated: paths.length > CODE_LIMITS.paths };
}

export function sortEntries(entries: RepoEntry[]) {
  return entries.sort(
    (a, b) => Number(b.kind === 'directory') - Number(a.kind === 'directory') || a.name.localeCompare(b.name)
  );
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

export function listTreeRecords(bytes: Uint8Array) {
  return splitRecords(bytes)
    .map(parseTreeRecord)
    .filter((record): record is TreeRecord => record !== null);
}

export function parseTreeObject(bytes: Uint8Array, dir: string, idBytes: number) {
  const records: TreeRecord[] = [];
  const prefix = dir ? `${dir}/` : '';
  let at = 0;
  while (at < bytes.length) {
    const space = bytes.indexOf(32, at);
    const end = bytes.indexOf(0, space);
    if (space < 0 || end < 0) break;
    const mode = decodeText(bytes.subarray(at, space));
    const name = decodeText(bytes.subarray(space + 1, end));
    const object = Buffer.from(bytes.subarray(end + 1, end + 1 + idBytes)).toString('hex');
    at = end + 1 + idBytes;
    const kind = TREE_MODES[mode] ?? 'file';
    records.push({ entry: { name, path: `${prefix}${name}`, kind, size: null }, object });
  }
  return records;
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
    entries.set(name, { name, path: `${prefix}${name}`, kind: slash < 0 ? 'file' : 'directory', size: null });
  }
  return { ref: paths.ref, dir, entries: sortEntries([...entries.values()]) };
}

export function describeBytes(ref: string, path: string, bytes: Uint8Array, size: number): FileContent {
  const binary = bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  return {
    ref,
    path,
    content: binary ? null : decodeText(bytes),
    size,
    binary,
    tooLarge: false,
    missing: false,
    image: binary ? Option.getOrNull(resolveImageType(path)) : null,
  };
}

export function describeAbsent(ref: string, path: string, size: number, tooLarge: boolean): FileContent {
  return {
    ref,
    path,
    content: null,
    size,
    binary: false,
    tooLarge,
    missing: !tooLarge,
    image: tooLarge ? Option.getOrNull(resolveImageType(path)) : null,
  };
}

export function resolvePathspec(glob: string | null) {
  if (!glob) return [];
  return [`:(glob)${glob.includes('/') ? glob : `**/${glob}`}`];
}

export function resolveGrepPattern(search: Pick<SearchQuery, 'query' | 'regex' | 'caseSensitive'>) {
  if (search.regex)
    return { flags: ['-E', search.caseSensitive ? '--no-ignore-case' : '-i'], pattern: search.query };
  if (search.caseSensitive) return { flags: ['-F', '--no-ignore-case'], pattern: search.query };
  const pattern = [...search.query]
    .map((character) => {
      const lower = character.toLowerCase();
      const upper = character.toUpperCase();
      if (lower !== upper && lower.length === 1 && upper.length === 1) return `[${lower}${upper}]`;
      return character.replace(ERE_SPECIAL, '\\$&');
    })
    .join('');
  return { flags: ['-E', '--no-ignore-case'], pattern };
}

export function parseMatch(record: string, sha: string | null): SearchMatch | null {
  const [location = '', line = '', column = '', ...rest] = record.split('\0');
  const path = sha && location.startsWith(`${sha}:`) ? location.slice(sha.length + 1) : location;
  const number = Number(line);
  if (!path || !Number.isInteger(number) || number < 1) return null;
  return { path, line: number, column: Number(column) || 1, text: rest.join('\0').slice(0, MATCH_TEXT) };
}

export function parseInfoLine(line: string) {
  const [object = '', type = '', size = ''] = line.split(' ');
  if (!/^[0-9a-f]{40,64}$/.test(object) || !type || !/^\d+$/.test(size)) return null;
  return { object, type, size: Number(size) };
}

export function isBatchName(name: string) {
  return name.length > 0 && !name.includes('\n') && !name.includes('\0');
}
