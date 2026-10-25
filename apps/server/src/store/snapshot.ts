import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReplayFailure, ShinsaState } from '@shinsa/core';
import type { UnreadableEvent } from './event-log.ts';

export type LogProblem = (ReplayFailure | UnreadableEvent) & { kind: 'unreadable' | 'unappliable' };

const SNAPSHOT_FORMAT = 1;

export interface StateSnapshot {
  seq: number;
  version: string;
  payload: string;
  problems: LogProblem[];
}

export interface SnapshotRow {
  seq: number;
  version: string;
  payload: string;
  problems: string;
  checksum: string;
  anchor: string;
}

type SnapshotRefusal = 'version' | 'checksum' | 'anchor' | 'unreadable';

export type SnapshotRead =
  | { ok: true; seq: number; state: ShinsaState; problems: LogProblem[] }
  | { ok: false; seq: number; reason: SnapshotRefusal };

function parseSnapshot(row: SnapshotRow): SnapshotRead {
  try {
    const state = JSON.parse(row.payload) as ShinsaState;
    const problems = JSON.parse(row.problems) as LogProblem[];
    if (state?.seq !== row.seq || !Array.isArray(problems))
      return { ok: false, seq: row.seq, reason: 'unreadable' };
    return { ok: true, seq: row.seq, state, problems };
  } catch {
    return { ok: false, seq: row.seq, reason: 'unreadable' };
  }
}

export function verifySnapshot(
  row: SnapshotRow,
  expected: { version: string; anchor: string }
): SnapshotRead {
  if (row.version !== expected.version) return { ok: false, seq: row.seq, reason: 'version' };
  if (row.anchor !== expected.anchor) return { ok: false, seq: row.seq, reason: 'anchor' };
  if (Bun.hash(row.payload).toString(36) !== row.checksum)
    return { ok: false, seq: row.seq, reason: 'checksum' };
  return parseSnapshot(row);
}

function resolveCoreSource() {
  return dirname(fileURLToPath(import.meta.resolve('@shinsa/core')));
}

export function resolveStateVersion(root = resolveCoreSource()): string | null {
  try {
    const files = [...new Bun.Glob('**/*.ts').scanSync({ cwd: root })].sort();
    if (files.length === 0) return null;
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(`shinsa-state-${SNAPSHOT_FORMAT}`);
    for (const file of files) {
      hasher.update(`\n${file}\n`);
      hasher.update(readFileSync(join(root, file)));
    }
    return hasher.digest('hex').slice(0, 24);
  } catch {
    return null;
  }
}
