import type { FSWatcher } from 'node:fs';
import type { ChatEntry } from '@shinsa/core';

export type TranscriptListener = (runId: string, entries: ChatEntry[], start: number | null) => void;

export interface Follower {
  count: number;
  watcher: FSWatcher | null;
  stopChecking: (() => void) | null;
}

export interface RunFile {
  offset: number;
  entries: ChatEntry[];
}

export interface TranscriptRead {
  entries: ChatEntry[];
  start: number;
}

export type FileWatcher = (path: string, onChange: () => void) => FSWatcher;

export type CheckRepeater = (check: () => void) => () => void;

export const CHECK_MS = 1_000;

export const CACHED_RUNS = 8;

export const UNREADABLE_LINE = 'Shinsa could not read one line of this transcript.';
