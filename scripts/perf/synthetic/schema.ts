import type { CommandCommit } from '../../../apps/engine/src/store/commands/schema.ts';
import type { StoredBriefing } from '../../../packages/core/src/index.ts';

export interface SyntheticOptions {
  tasks: number;
  targetEvents: number;
  longTranscripts: number;
  longTranscriptEntries: number;
  shortTranscriptEntries: number;
}

export interface SyntheticLog {
  commits: CommandCommit[];
  briefings: StoredBriefing[];
  events: number;
  tasks: number;
  runIds: string[];
  longRunIds: string[];
}

export const LARGE: SyntheticOptions = {
  tasks: 200,
  targetEvents: 50_000,
  longTranscripts: 20,
  longTranscriptEntries: 5_000,
  shortTranscriptEntries: 60,
};

export const DEFAULT_SYNTHETIC_DIR = '/tmp/shinsa-perf/large/data';
