import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareVersions, readProgramVersion } from '../versions.ts';

const CLAUDE_EXECUTABLE_ENV = 'CLAUDE_EXECUTABLE';

export type ClaudeExecutable =
  | { ok: true; path: string; version: string | null }
  | { ok: false; reason: 'not_installed' | 'outdated'; message: string };

type VersionReader = (path: string) => Promise<string | null>;

export interface ExecutableDeps {
  env?: Record<string, string | undefined>;
  which?: (command: string) => string | null;
  readVersion?: VersionReader;
  minimumVersion?: string;
}

export function resolveSdkClaudeVersion(packagePath = resolveSdkPackagePath()) {
  const version = (JSON.parse(readFileSync(packagePath, 'utf8')) as { claudeCodeVersion?: unknown })
    .claudeCodeVersion;
  return typeof version === 'string' ? version : '0.0.0';
}

function resolveSdkPackagePath() {
  return join(dirname(fileURLToPath(import.meta.resolve('@anthropic-ai/claude-agent-sdk'))), 'package.json');
}

export function parseClaudeVersion(output: string) {
  return /(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null;
}

export function readClaudeVersion(path: string) {
  return readProgramVersion(path, parseClaudeVersion);
}

function resolveOverride(env: Record<string, string | undefined>) {
  const value = env[CLAUDE_EXECUTABLE_ENV]?.trim();
  return value ? value.replace(/^~(?=\/|$)/, homedir()) : null;
}

function whichOnPath(command: string) {
  return Bun.which(command, { PATH: Bun.env.PATH });
}

export async function resolveClaudeExecutable(deps: ExecutableDeps = {}): Promise<ClaudeExecutable> {
  const override = resolveOverride(deps.env ?? Bun.env);
  if (override) return { ok: true, path: override, version: null };
  const path = (deps.which ?? whichOnPath)('claude');
  if (!path) {
    return {
      ok: false,
      reason: 'not_installed',
      message: `Claude Code is not installed. Install it from https://claude.com/claude-code, or set ${CLAUDE_EXECUTABLE_ENV} to the program to run.`,
    };
  }
  const version = await (deps.readVersion ?? readClaudeVersion)(path);
  const minimum = deps.minimumVersion ?? resolveSdkClaudeVersion();
  if (version && compareVersions(version, minimum) < 0) {
    return {
      ok: false,
      reason: 'outdated',
      message: `Claude Code ${version} is older than Shinsa needs (${minimum} or newer). Update it with \`claude update\`.`,
    };
  }
  return { ok: true, path, version };
}

export type ExecutableResolver = () => Promise<ClaudeExecutable>;
