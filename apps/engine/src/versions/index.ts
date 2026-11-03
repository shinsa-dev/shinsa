import type { ProgramId } from '@shinsa/core';
import { Effect } from 'effect';
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
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { awaitAbort } from '../shell/abort.ts';
import {
  NpmRegistryFailed,
  type UpdateRun,
  type VersionsHandle,
  VersionsCallFailed,
  type VersionsOptions,
} from './schema.ts';
import { makeVersions } from './service.ts';
import { resolveUpdater } from './updaters.ts';

export { LATEST_TTL_MS, type UpdateRun, type UpdateRunner, type VersionsOptions } from './schema.ts';

function locateInstalledProgram(program: ProgramId) {
  return program === 'claude' ? locateClaude() : locateCodex();
}

function readInstalledVersion(program: ProgramId, path: string) {
  return program === 'claude' ? readClaudeVersion(path) : readCodexVersion(path);
}

function resolveMinimumVersion(program: ProgramId) {
  return program === 'claude' ? resolveSdkClaudeVersion() : CODEX_MINIMUM_VERSION;
}

function failed(error: unknown) {
  return new VersionsCallFailed({ message: describeError(error) });
}

function bridgeLatest(latest: (name: string) => Promise<string>) {
  return (name: string) =>
    Effect.tryPromise({
      try: () => latest(name),
      catch: (error) => new NpmRegistryFailed({ packageName: name, message: describeError(error) }),
    });
}

export class Versions {
  readonly #abort = new AbortController();
  readonly #handle: VersionsHandle;

  constructor(options: VersionsOptions = {}) {
    const { signal } = this.#abort;
    const { latest, run, onUpdated } = options;
    const readVersion = options.readVersion ?? readInstalledVersion;
    this.#handle = edgeRuntime.runSync(
      makeVersions({
        inspect: options.inspect ?? false,
        now: Effect.sync(options.now ?? Date.now),
        locate: options.locate ?? locateInstalledProgram,
        readVersion: (program, path) =>
          Effect.tryPromise({ try: () => readVersion(program, path), catch: failed }),
        minimum: options.minimum ?? resolveMinimumVersion,
        sdk: options.sdk ?? resolveSdkPackage,
        latest: latest ? bridgeLatest(latest) : null,
        updater: options.updater ?? resolveUpdater,
        run: run
          ? (updater, onLine) => Effect.tryPromise({ try: () => run(updater, onLine, signal), catch: failed })
          : null,
        onUpdated: (program) =>
          onUpdated
            ? Effect.asVoid(Effect.tryPromise({ try: () => onUpdated(program), catch: failed }))
            : Effect.void,
        cancel: awaitAbort(signal),
      })
    );
  }

  snapshot() {
    return edgeRuntime.runPromise(this.#handle.snapshot);
  }

  refresh() {
    return edgeRuntime.runPromise(this.#handle.refresh);
  }

  startUpdate(program: unknown): UpdateRun {
    const update = edgeRuntime.runSync(this.#handle.startUpdate(program));
    return (onLine) => edgeRuntime.runPromise(update(onLine));
  }

  stop() {
    this.#abort.abort();
  }
}
