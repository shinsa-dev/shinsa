import { Duration, type Effect } from 'effect';
import type { Shell } from '../../../shell/service.ts';

export interface ProgramLocation {
  path: string | null;
  override: string | null;
}

export interface LocateDeps {
  env?: Record<string, string | undefined>;
  which?: (command: string) => string | null;
}

export type VersionParser = (output: string) => string | null;

export interface CachedVersion {
  readonly modifiedAt: number;
  readonly version: string | null;
}

export interface ProgramVersionsHandle {
  readonly read: (path: string, parse: VersionParser) => Effect.Effect<string | null, never, Shell>;
}

export const VERSION_TIMEOUT = Duration.seconds(15);

export const UNREADABLE_MODIFIED_AT = -1;
