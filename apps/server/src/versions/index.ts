import { homedir } from 'node:os';
import {
  DomainError,
  HOUR_MS,
  type ProgramId,
  type ProgramVersion,
  type ProgramVersionStatus,
  type UpdateOutcome,
  type VersionsSnapshot,
} from '@shinsa/core';
import {
  locateClaude,
  readClaudeVersion,
  resolveSdkClaudeVersion,
  resolveSdkPackage,
} from '../agents/providers/claude/executable.ts';
import {
  CODEX_MINIMUM_VERSION,
  locateCodex,
  readCodexVersion,
} from '../agents/providers/codex/executable.ts';
import { compareVersions, type ProgramLocation } from '../agents/providers/versions.ts';
import { describeError, log, redactSecrets } from '../log/index.ts';
import { type CommandResult, runCommand } from '../shell/index.ts';
import { requestLatestVersion } from './registry.ts';
import { resolveUpdater, type Updater } from './updaters.ts';

export const LATEST_TTL_MS = 3 * HOUR_MS;

const UPDATE_TIMEOUT_MS = 10 * 60_000;

const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

const PROGRAMS: Record<ProgramId, { label: string; package: string; overrideEnv: string }> = {
  claude: { label: 'Claude Code', package: '@anthropic-ai/claude-code', overrideEnv: 'CLAUDE_EXECUTABLE' },
  codex: { label: 'Codex', package: '@openai/codex', overrideEnv: 'CODEX_EXECUTABLE' },
};

const PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[];

type LineListener = (line: string) => void;

export type UpdateRunner = (
  updater: Updater,
  onLine: LineListener,
  signal: AbortSignal
) => Promise<CommandResult>;

export interface VersionsOptions {
  inspect?: boolean;
  locate?: (program: ProgramId) => ProgramLocation;
  readVersion?: (program: ProgramId, path: string) => Promise<string | null>;
  minimum?: (program: ProgramId) => string;
  sdk?: () => { version: string; claudeCodeVersion: string };
  latest?: (name: string) => Promise<string>;
  updater?: (program: ProgramId, path: string) => Updater;
  run?: UpdateRunner;
  onUpdated?: (program: ProgramId) => Promise<unknown>;
  now?: () => number;
}

function locateInstalledProgram(program: ProgramId) {
  return program === 'claude' ? locateClaude() : locateCodex();
}

function readInstalledVersion(program: ProgramId, path: string) {
  return program === 'claude' ? readClaudeVersion(path) : readCodexVersion(path);
}

function resolveMinimumVersion(program: ProgramId) {
  return program === 'claude' ? resolveSdkClaudeVersion() : CODEX_MINIMUM_VERSION;
}

function runUpdater(updater: Updater, onLine: LineListener, signal: AbortSignal) {
  return runCommand(updater.command, homedir(), {
    env: { NO_COLOR: '1', FORCE_COLOR: '0', ...updater.env },
    timeoutMs: UPDATE_TIMEOUT_MS,
    onLine,
    signal,
  });
}

function resolveProgramStatus(
  version: string | null,
  latest: string | null,
  minimum: string
): ProgramVersionStatus {
  if (!version) return 'unknown';
  if (compareVersions(version, minimum) < 0) return 'outdated';
  if (latest && compareVersions(version, latest) < 0) return 'update_available';
  return 'current';
}

function cleanOutputLine(line: string) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: updaters colour and redraw their output with escape codes
  return redactSecrets(line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trim());
}

function readProgramId(value: unknown): ProgramId {
  if (value === 'claude' || value === 'codex') return value;
  throw new DomainError('program_invalid', 'Name the program to update: claude or codex.');
}

function describeRunFailure(label: string, result: CommandResult) {
  const output = (result.stderr || result.stdout).split('\n').map(cleanOutputLine).filter(Boolean);
  const reason = result.timedOut
    ? 'it ran too long and was stopped'
    : (output.at(-1) ?? `exit ${result.code}`);
  return `Couldn’t update ${label}: ${reason}`;
}

function describeUpdated(program: ProgramVersion, before: string | null) {
  if (program.status === 'update_available') {
    return {
      ok: false,
      message: `The update finished, but ${program.label} still reports ${program.version} (latest is ${program.latest}).`,
    };
  }
  if (program.version && program.version !== before) {
    return { ok: true, message: `Updated ${program.label} to ${program.version}.` };
  }
  return { ok: true, message: `${program.label} is up to date.` };
}

export class Versions {
  readonly #options: VersionsOptions;
  readonly #latest = new Map<string, string>();
  readonly #running = new Set<ProgramId>();
  readonly #abort = new AbortController();
  #checkedAt: number | null = null;
  #checking: Promise<void> | null = null;

  constructor(options: VersionsOptions = {}) {
    this.#options = options;
  }

  #now() {
    return (this.#options.now ?? Date.now)();
  }

  #syncLatest() {
    if (this.#checkedAt !== null && this.#now() - this.#checkedAt < LATEST_TTL_MS) return Promise.resolve();
    this.#checking ??= this.#readLatest().finally(() => {
      this.#checking = null;
    });
    return this.#checking;
  }

  async #readLatest() {
    const latest = this.#options.latest ?? requestLatestVersion;
    const names = [...PROGRAM_IDS.map((id) => PROGRAMS[id].package), SDK_PACKAGE];
    await Promise.all(
      names.map(async (name) => {
        try {
          this.#latest.set(name, await latest(name));
        } catch (error) {
          log.warn('[Versions] Could not read the latest version', { name, error: describeError(error) });
        }
      })
    );
    this.#checkedAt = this.#now();
  }

  async #readProgram(id: ProgramId): Promise<ProgramVersion> {
    const { label, package: name } = PROGRAMS[id];
    const { path, override } = (this.#options.locate ?? locateInstalledProgram)(id);
    const minimum = (this.#options.minimum ?? resolveMinimumVersion)(id);
    const latest = this.#latest.get(name) ?? null;
    const base = { id, label, path, latest, minimum, override, updating: this.#running.has(id) };
    if (!path) return { ...base, version: null, status: 'not_installed', updater: null };
    if (override) return { ...base, version: null, status: 'unknown', updater: null };
    const version = await (this.#options.readVersion ?? readInstalledVersion)(id, path);
    return {
      ...base,
      version,
      status: resolveProgramStatus(version, latest, minimum),
      updater: this.#resolveUpdater(id, path).label,
    };
  }

  #resolveUpdater(id: ProgramId, path: string) {
    return (this.#options.updater ?? resolveUpdater)(id, path);
  }

  async snapshot(): Promise<VersionsSnapshot> {
    await this.#syncLatest();
    const programs = await Promise.all(PROGRAM_IDS.map((id) => this.#readProgram(id)));
    const sdk = (this.#options.sdk ?? resolveSdkPackage)();
    return {
      programs,
      sdk: { name: SDK_PACKAGE, ...sdk, latest: this.#latest.get(SDK_PACKAGE) ?? null },
      latestCheckedAt: this.#checkedAt,
    };
  }

  refresh() {
    this.#checkedAt = null;
    return this.snapshot();
  }

  startUpdate(program: unknown): (onLine: LineListener) => Promise<UpdateOutcome> {
    const id = readProgramId(program);
    const { label, overrideEnv } = PROGRAMS[id];
    if (this.#options.inspect) {
      throw new DomainError(
        'inspect_mode',
        `Shinsa is in inspect mode and only shows this data. Start it without SHINSA_INSPECT to update ${label}.`
      );
    }
    if (this.#running.has(id)) throw new DomainError('update_running', `${label} is already updating.`);
    const { path, override } = (this.#options.locate ?? locateInstalledProgram)(id);
    if (!path) throw new DomainError('program_missing', `${label} is not installed.`);
    if (override) {
      throw new DomainError(
        'program_override',
        `Shinsa runs ${override} for ${label} (${overrideEnv}), so update that program yourself.`
      );
    }
    this.#running.add(id);
    return (onLine) => this.#update(id, path, onLine).finally(() => this.#running.delete(id));
  }

  async #update(id: ProgramId, path: string, onLine: LineListener): Promise<UpdateOutcome> {
    const { label } = PROGRAMS[id];
    const readVersion = this.#options.readVersion ?? readInstalledVersion;
    const before = await readVersion(id, path);
    const updater = this.#resolveUpdater(id, path);
    log.info('[Versions] Updating', { program: id, command: updater.label });
    const result = await (this.#options.run ?? runUpdater)(
      updater,
      (line) => {
        const clean = cleanOutputLine(line);
        if (clean) onLine(clean);
      },
      this.#abort.signal
    );
    this.#running.delete(id);
    if (!result.ok) {
      const message = describeRunFailure(label, result);
      log.warn('[Versions] Update failed', { program: id, reason: message });
      return { ok: false, message, versions: await this.snapshot() };
    }
    await this.#options.onUpdated?.(id);
    const versions = await this.snapshot();
    return { ...describeUpdated(await this.#readProgram(id), before), versions };
  }

  stop() {
    this.#abort.abort();
  }
}
