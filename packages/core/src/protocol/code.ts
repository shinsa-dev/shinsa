export const WORKING_REF = 'working';

export const CODE_LIMITS = {
  blobBytes: 2_000_000,
  paths: 200_000,
  matches: 2_000,
  readMs: 5_000,
  queryLength: 500,
} as const;

export interface RefCommit {
  sha: string;
  subject: string;
  at: number;
}

export interface TaskRefs {
  head: string;
  base: string | null;
  branch: string | null;
  defaultBranch: string;
  working: boolean;
  dirty: boolean;
  commits: RefCommit[];
}

export type RepoEntryKind = 'file' | 'directory' | 'symlink' | 'submodule';

export interface RepoEntry {
  name: string;
  path: string;
  kind: RepoEntryKind;
  size: number | null;
}

export interface RepoPaths {
  ref: string;
  paths: string[];
  truncated: boolean;
}

export interface RepoTree {
  ref: string;
  dir: string;
  entries: RepoEntry[];
}

export interface FileContent {
  ref: string;
  path: string;
  content: string | null;
  size: number;
  binary: boolean;
  tooLarge: boolean;
  missing: boolean;
  image: string | null;
}

export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchResult {
  ref: string;
  matches: SearchMatch[];
  truncated: boolean;
  timedOut: boolean;
}

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export function resolveImageType(path: string) {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return IMAGE_TYPES[path.slice(dot + 1).toLowerCase()] ?? null;
}

export function isCommitSha(value: string) {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value);
}
