import type { Effect } from 'effect';
import type { LocateDeps, ProgramLocation } from '../../versions/schema.ts';

export type ClaudeExecutable =
  | { ok: true; path: string; version: string | null }
  | { ok: false; reason: 'not_installed' | 'outdated'; message: string };

export interface ExecutableDeps extends LocateDeps {
  readVersion?: (path: string) => Effect.Effect<string | null>;
  minimumVersion?: string;
}

export type ExecutableResolver = Effect.Effect<ClaudeExecutable>;

export interface ClaudeExecutableDefinition {
  readonly location: ProgramLocation;
  readonly readVersion: (path: string) => Effect.Effect<string | null>;
  readonly minimumVersion: Effect.Effect<string>;
}

export const CLAUDE_EXECUTABLE_ENV = 'CLAUDE_EXECUTABLE';

export const CLAUDE_INSTALL_URL = 'https://claude.com/claude-code';
