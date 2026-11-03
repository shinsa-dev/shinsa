import { homedir } from 'node:os';
import {
  DomainError,
  type ProgramId,
  type ProgramVersion,
  type ProgramVersionStatus,
  type UpdateOutcome,
  type VersionsSnapshot,
} from '@shinsa/core';
import { Effect, Ref, Semaphore } from 'effect';
import { compareVersions } from '../agents/providers/versions.ts';
import { createReadOnlyError } from '../instance/index.ts';
import { redactSecrets } from '../log/redact.ts';
import { type CommandResult, NOT_STARTED_EXIT_CODE } from '../shell/schema.ts';
import { Shell } from '../shell/service.ts';
import { isProgramId } from './program.ts';
import { NpmRegistry } from './registry/service.ts';
import {
  LATEST_TTL_MS,
  type LineListener,
  PROGRAM_IDS,
  PROGRAMS,
  SDK_PACKAGE,
  UPDATE_ENV,
  UPDATE_TIMEOUT,
  type Updater,
  type VersionsDefinition,
  type VersionsHandle,
} from './schema.ts';

export const makeVersions = Effect.fn('Versions.make')(function* (definition: VersionsDefinition) {
  const shell = yield* Shell;
  const registry = yield* NpmRegistry;
  const latest = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
  const running = yield* Ref.make<ReadonlySet<ProgramId>>(new Set());
  const checkedAt = yield* Ref.make<number | null>(null);
  const checking = yield* Semaphore.make(1);
  const lookUp = definition.latest ?? registry.latest;

  const resolveProgramStatus = (
    version: string | null,
    known: string | null,
    minimum: string
  ): ProgramVersionStatus => {
    if (!version) return 'unknown';
    if (compareVersions(version, minimum) < 0) return 'outdated';
    if (known && compareVersions(version, known) < 0) return 'update_available';
    return 'current';
  };

  const cleanOutputLine = (line: string) =>
    // oxlint-disable-next-line eslint/no-control-regex -- updaters colour and redraw their output with escape codes
    redactSecrets(line.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').trim());

  const describeRunFailure = (label: string, result: CommandResult) => {
    const output = (result.stderr || result.stdout).split('\n').map(cleanOutputLine).filter(Boolean);
    const reason = result.timedOut
      ? 'it ran too long and was stopped'
      : (output.at(-1) ?? `exit ${result.code}`);
    return `Couldn’t update ${label}: ${reason}`;
  };

  const describeUpdated = (program: ProgramVersion, before: string | null) => {
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
  };

  const release = (id: ProgramId) =>
    Ref.update(running, (ids) => new Set([...ids].filter((runningId) => runningId !== id)));

  const readLatest = Effect.gen(function* () {
    const names = [...PROGRAM_IDS.map((id) => PROGRAMS[id].package), SDK_PACKAGE];
    yield* Effect.forEach(
      names,
      (name) =>
        lookUp(name).pipe(
          Effect.flatMap((version) => Ref.update(latest, (known) => new Map(known).set(name, version))),
          Effect.catch((failure) =>
            Effect.logWarning('[Versions] Could not read the latest version').pipe(
              Effect.annotateLogs({ name, error: failure.message })
            )
          )
        ),
      { concurrency: 'unbounded', discard: true }
    );
    yield* Ref.set(checkedAt, yield* definition.now);
  });

  const syncLatest = Semaphore.withPermit(
    checking,
    Effect.gen(function* () {
      const at = yield* Ref.get(checkedAt);
      if (at !== null && (yield* definition.now) - at < LATEST_TTL_MS) return;
      yield* readLatest;
    })
  );

  const readProgram = Effect.fn('Versions.readProgram')(function* (id: ProgramId) {
    const { label, package: name } = PROGRAMS[id];
    const { path, override } = definition.locate(id);
    const minimum = definition.minimum(id);
    const known = (yield* Ref.get(latest)).get(name) ?? null;
    const updating = (yield* Ref.get(running)).has(id);
    const base = { id, label, path, latest: known, minimum, override, updating };
    if (!path) {
      const missing: ProgramVersion = { ...base, version: null, status: 'not_installed', updater: null };
      return missing;
    }
    if (override) {
      const overridden: ProgramVersion = { ...base, version: null, status: 'unknown', updater: null };
      return overridden;
    }
    const version = yield* definition.readVersion(id, path);
    const program: ProgramVersion = {
      ...base,
      version,
      status: resolveProgramStatus(version, known, minimum),
      updater: definition.updater(id, path).label,
    };
    return program;
  });

  const snapshot = Effect.gen(function* () {
    yield* syncLatest;
    const programs = yield* Effect.forEach(PROGRAM_IDS, readProgram, { concurrency: 'unbounded' });
    const sdk = definition.sdk();
    const versions: VersionsSnapshot = {
      programs,
      sdk: { name: SDK_PACKAGE, ...sdk, latest: (yield* Ref.get(latest)).get(SDK_PACKAGE) ?? null },
      latestCheckedAt: yield* Ref.get(checkedAt),
    };
    return versions;
  });

  const runUpdater = (updater: Updater, onLine: LineListener) =>
    shell
      .run({
        argv: updater.command,
        cwd: homedir(),
        env: { ...UPDATE_ENV, ...updater.env },
        timeout: UPDATE_TIMEOUT,
        cancel: definition.cancel,
        onLine: (line) => Effect.sync(() => onLine(line)),
      })
      .pipe(
        Effect.catchTag('CommandNotFound', (missing) => {
          const result: CommandResult = {
            ok: false,
            code: NOT_STARTED_EXIT_CODE,
            stdout: '',
            stderr: missing.message,
            timedOut: false,
          };
          return Effect.succeed(result);
        })
      );

  const run = definition.run ?? runUpdater;

  const update = Effect.fn('Versions.update')(function* (id: ProgramId, path: string, onLine: LineListener) {
    const { label } = PROGRAMS[id];
    const before = yield* definition.readVersion(id, path);
    const updater = definition.updater(id, path);
    yield* Effect.logInfo('[Versions] Updating').pipe(
      Effect.annotateLogs({ program: id, command: updater.label })
    );
    const result = yield* run(updater, (line) => {
      const clean = cleanOutputLine(line);
      if (clean) onLine(clean);
    });
    yield* release(id);
    if (!result.ok) {
      const message = describeRunFailure(label, result);
      yield* Effect.logWarning('[Versions] Update failed').pipe(
        Effect.annotateLogs({ program: id, reason: message })
      );
      const failed: UpdateOutcome = { ok: false, message, versions: yield* snapshot };
      return failed;
    }
    yield* definition.onUpdated(id);
    const versions = yield* snapshot;
    const outcome: UpdateOutcome = { ...describeUpdated(yield* readProgram(id), before), versions };
    return outcome;
  });

  const startUpdate = Effect.fn('Versions.startUpdate')(function* (program: unknown) {
    if (!isProgramId(program))
      return yield* new DomainError({ code: 'program_invalid', message: 'Update claude or codex.' });
    const { label, overrideEnv } = PROGRAMS[program];
    if (definition.inspect) return yield* createReadOnlyError();
    if ((yield* Ref.get(running)).has(program))
      return yield* new DomainError({ code: 'update_running', message: `${label} is already updating.` });
    const { path, override } = definition.locate(program);
    if (!path)
      return yield* new DomainError({ code: 'program_missing', message: `${label} is not installed.` });
    if (override) {
      return yield* new DomainError({
        code: 'program_override',
        message: `Update ${label} yourself (${overrideEnv}).`,
      });
    }
    yield* Ref.update(running, (ids) => new Set(ids).add(program));
    return (onLine: LineListener) => update(program, path, onLine).pipe(Effect.ensuring(release(program)));
  });

  const handle: VersionsHandle = {
    snapshot,
    refresh: Effect.andThen(Ref.set(checkedAt, null), snapshot),
    startUpdate,
  };
  return handle;
});
