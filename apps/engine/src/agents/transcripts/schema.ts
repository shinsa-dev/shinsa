import { type FSWatcher, watch } from 'node:fs';
import type { ChatEntry } from '@shinsa/core';
import { Context, Duration, Schedule } from 'effect';

export type TranscriptListener = (runId: string, entries: ChatEntry[], start: number | null) => void;

export interface Follower {
  count: number;
  watcher: FSWatcher | null;
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

export const TranscriptWatch = Context.Reference<FileWatcher>(
  'shinsa/engine/agents/transcripts/TranscriptWatch',
  {
    defaultValue: () => watch,
  }
);

export const TRANSCRIPT_CHECK = Schedule.spaced(Duration.seconds(1));

export const CACHED_RUNS = 8;

export const UNREADABLE_LINE = 'Shinsa could not read one line of this transcript.';
