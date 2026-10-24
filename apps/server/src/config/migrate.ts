import { Database } from 'bun:sqlite';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export type MigrationResult =
  | { status: 'none' }
  | { status: 'migrated'; from: string; to: string; events: number; files: number }
  | { status: 'failed'; from: string; to: string; reason: string };

export const DATABASE_FILE = 'shinsa.sqlite';

const COPIED_DIRS = ['transcripts', 'evidence'];

interface DatabaseCount {
  events: number;
  lastSeq: number;
  effects: number;
}

function countDatabase(path: string): DatabaseCount {
  const db = new Database(path, { readonly: true });
  try {
    const events = db
      .query<{ n: number; last: number | null }, []>('SELECT COUNT(*) AS n, MAX(seq) AS last FROM events')
      .get();
    const effects = db.query<{ n: number }, []>('SELECT COUNT(*) AS n FROM effects').get();
    return { events: events?.n ?? 0, lastSeq: events?.last ?? 0, effects: effects?.n ?? 0 };
  } finally {
    db.close();
  }
}

function snapshotDatabase(from: string, to: string) {
  const db = new Database(from, { readonly: true });
  try {
    db.run('VACUUM INTO ?', [to]);
  } finally {
    db.close();
  }
}

function listFiles(root: string): Map<string, number> {
  const files = new Map<string, number>();
  if (!existsSync(root)) return files;
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.set(relative(root, path), statSync(path).size);
    }
  };
  walk(root);
  return files;
}

function describeMismatch(name: string, source: Map<string, number>, copy: Map<string, number>) {
  for (const [file, size] of source) {
    if (copy.get(file) !== size) return `${name}/${file} did not copy completely.`;
  }
  return null;
}

function isEmptyDirectory(path: string) {
  return statSync(path).isDirectory() && readdirSync(path).length === 0;
}

export interface MigrationCopiers {
  snapshot: (from: string, to: string) => void;
  copyTree: (from: string, to: string) => void;
}

const COPIERS: MigrationCopiers = {
  snapshot: snapshotDatabase,
  copyTree: (from, to) => cpSync(from, to, { recursive: true }),
};

function copyAndVerify(from: string, staging: string, copiers: MigrationCopiers) {
  mkdirSync(staging, { recursive: true });
  copiers.snapshot(join(from, DATABASE_FILE), join(staging, DATABASE_FILE));
  const source = countDatabase(join(from, DATABASE_FILE));
  const copy = countDatabase(join(staging, DATABASE_FILE));
  if (source.events !== copy.events || source.lastSeq !== copy.lastSeq || source.effects !== copy.effects) {
    throw new Error(
      `The database copy has ${copy.events} events, the original ${source.events}; nothing was switched.`
    );
  }
  let files = 0;
  for (const name of COPIED_DIRS) {
    const sourceFiles = listFiles(join(from, name));
    if (sourceFiles.size > 0) copiers.copyTree(join(from, name), join(staging, name));
    const mismatch = describeMismatch(name, sourceFiles, listFiles(join(staging, name)));
    if (mismatch) throw new Error(mismatch);
    files += sourceFiles.size;
  }
  return { events: source.events, files };
}

export function migrateLegacyData(
  from: string | null,
  to: string,
  copiers: MigrationCopiers = COPIERS
): MigrationResult {
  if (!from || from === to) return { status: 'none' };
  if (!existsSync(join(from, DATABASE_FILE)) || existsSync(join(to, DATABASE_FILE)))
    return { status: 'none' };
  if (existsSync(to) && !isEmptyDirectory(to)) {
    return { status: 'failed', from, to, reason: `${to} already holds other files; nothing was moved.` };
  }
  const staging = `${to}.migrating-${process.pid}-${Date.now()}`;
  try {
    const { events, files } = copyAndVerify(from, staging, copiers);
    if (existsSync(to)) rmdirSync(to);
    mkdirSync(dirname(to), { recursive: true });
    renameSync(staging, to);
    return { status: 'migrated', from, to, events, files };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (existsSync(join(to, DATABASE_FILE))) return { status: 'none' };
    return { status: 'failed', from, to, reason: error instanceof Error ? error.message : String(error) };
  }
}
