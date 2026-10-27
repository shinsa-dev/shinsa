import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLE, type ShinsaBundle } from '../../../instance/bundle.ts';
import { compareVersions, type LocateDeps, locateProgram, readProgramVersion } from '../versions.ts';

const CLAUDE_EXECUTABLE_ENV = 'CLAUDE_EXECUTABLE';

export type ClaudeExecutable =
  | { ok: true; path: string; version: string | null }
  | { ok: false; reason: 'not_installed' | 'outdated'; message: string };

type VersionReader = (path: string) => Promise<string | null>;

export interface ExecutableDeps extends LocateDeps {
  readVersion?: VersionReader;
  minimumVersion?: string;
}

function readVersionField(value: unknown) {
  return typeof value === 'string' ? value : '0.0.0';
}

export function resolveSdkPackage(packagePath?: string, bundle: ShinsaBundle | null = BUNDLE) {
  if (bundle && !packagePath) return bundle.sdk;
  const fields = JSON.parse(readFileSync(packagePath ?? resolveSdkPackagePath(), 'utf8')) as {
    version?: unknown;
    claudeCodeVersion?: unknown;
  };
  return {
    version: readVersionField(fields.version),
    claudeCodeVersion: readVersionField(fields.claudeCodeVersion),
  };
}

export function resolveSdkClaudeVersion(packagePath?: string) {
  return resolveSdkPackage(packagePath).claudeCodeVersion;
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

export function locateClaude(deps: LocateDeps = {}) {
  return locateProgram('claude', CLAUDE_EXECUTABLE_ENV, deps);
}

export async function resolveClaudeExecutable(deps: ExecutableDeps = {}): Promise<ClaudeExecutable> {
  const { path, override } = locateClaude(deps);
  if (override) return { ok: true, path: override, version: null };
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
      message: `Claude Code ${version} is older than Shinsa needs (${minimum} or newer). Update it from Settings → Agents, or run \`claude update\`.`,
    };
  }
  return { ok: true, path, version };
}

export type ExecutableResolver = () => Promise<ClaudeExecutable>;
