import type { Effect } from 'effect';
import type { LocateDeps } from '../../versions.ts';

export const CODEX_EXECUTABLE_ENV = 'CODEX_EXECUTABLE';

export const CODEX_MINIMUM_VERSION = '0.153.0';

export const CODEX_INSTALL = 'Install it with `npm install -g @openai/codex`';

export type CodexExecutable =
  | { ok: true; path: string; version: string | null }
  | { ok: false; reason: 'not_installed' | 'outdated'; message: string; version: string | null };

export interface CodexExecutableDeps extends LocateDeps {
  readVersion?: (path: string) => Promise<string | null>;
  minimumVersion?: string;
}

export type CodexExecutableResolver = () => Promise<CodexExecutable>;

export interface CodexExecutableDefinition {
  readonly path: string | null;
  readonly readVersion: (path: string) => Effect.Effect<string | null>;
  readonly minimumVersion: string;
}
