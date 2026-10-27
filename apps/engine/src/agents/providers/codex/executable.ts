import { compareVersions, type LocateDeps, locateProgram, readProgramVersion } from '../versions.ts';

const CODEX_EXECUTABLE_ENV = 'CODEX_EXECUTABLE';

export const CODEX_MINIMUM_VERSION = '0.153.0';

export const CODEX_INSTALL = 'Install it with `npm install -g @openai/codex`';

export type CodexExecutable =
  | { ok: true; path: string; version: string | null }
  | { ok: false; reason: 'not_installed' | 'outdated'; message: string; version: string | null };

export interface CodexExecutableDeps extends LocateDeps {
  readVersion?: (path: string) => Promise<string | null>;
  minimumVersion?: string;
}

export function parseCodexVersion(output: string) {
  return /codex-cli\s+(\d+\.\d+\.\d+)/i.exec(output)?.[1] ?? /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function readCodexVersion(path: string) {
  return readProgramVersion(path, parseCodexVersion);
}

export function locateCodex(deps: LocateDeps = {}) {
  return locateProgram('codex', CODEX_EXECUTABLE_ENV, deps);
}

export async function resolveCodexExecutable(deps: CodexExecutableDeps = {}): Promise<CodexExecutable> {
  const { path } = locateCodex(deps);
  if (!path) {
    return {
      ok: false,
      reason: 'not_installed',
      message: `Codex is not installed. ${CODEX_INSTALL}, or set ${CODEX_EXECUTABLE_ENV} to the program to run.`,
      version: null,
    };
  }
  const version = await (deps.readVersion ?? readCodexVersion)(path);
  const minimum = deps.minimumVersion ?? CODEX_MINIMUM_VERSION;
  if (version && compareVersions(version, minimum) < 0) {
    return {
      ok: false,
      reason: 'outdated',
      message: `Codex ${version} is older than Shinsa needs (${minimum} or newer). Update it from Settings → Agents, or run \`codex update\`.`,
      version,
    };
  }
  return { ok: true, path, version };
}

export type CodexExecutableResolver = () => Promise<CodexExecutable>;
