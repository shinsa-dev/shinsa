import type { Effect } from 'effect';
import type { LocateDeps, ProgramLocation } from '../../versions/schema.ts';

export type ClaudeExecutable =
  | { ok: true; path: string; version: string | null }
  | { ok: false; reason: 'not_installed' | 'outdated'; message: string };

type VersionReader = (path: string) => Promise<string | null>;

export interface ExecutableDeps extends LocateDeps {
  readVersion?: VersionReader;
  minimumVersion?: string;
}

export type ExecutableResolver = () => Promise<ClaudeExecutable>;

export interface ClaudeExecutableDefinition {
  readonly location: ProgramLocation;
  readonly readVersion: (path: string) => Effect.Effect<string | null>;
  readonly minimumVersion: Effect.Effect<string>;
}

export const CLAUDE_EXECUTABLE_ENV = 'CLAUDE_EXECUTABLE';

export const CLAUDE_INSTALL_URL = 'https://claude.com/claude-code';
