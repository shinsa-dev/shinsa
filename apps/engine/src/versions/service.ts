import {
  DomainError,
  type ProgramId,
  type ProgramVersion,
  type ProgramVersionStatus,
  type UpdateOutcome,
  type VersionsSnapshot,
} from '@shinsa/core';
import { Clock, Context, Deferred, Effect, Layer, Ref, Semaphore } from 'effect';
import { compareVersions } from '../agents/providers/versions.ts';
import { EngineConfig } from '../config/service.ts';
import { createReadOnlyError } from '../instance/inspect.ts';
import { redactSecrets } from '../log/redact.ts';
import type { CommandResult } from '../shell/schema.ts';
import { ProgramInstalls } from './installs/service.ts';
import { isProgramId } from './program.ts';
import { NpmRegistry } from './registry/service.ts';
import {
  LATEST_TTL_MS,
  type LineListener,
  PROGRAM_IDS,
  PROGRAMS,
  SDK_PACKAGE,
  type UpdateRun,
  type VersionsCallFailed,
  type VersionsInput,
} from './schema.ts';
import { UpdaterRunner } from './updater/service.ts';

export class Versions extends Context.Service<
  Versions,
  {
    readonly snapshot: Effect.Effect<VersionsSnapshot, VersionsCallFailed>;
    readonly refresh: Effect.Effect<VersionsSnapshot, VersionsCallFailed>;
    startUpdate(program: unknown): Effect.Effect<UpdateRun, DomainError>;
    readonly stop: Effect.Effect<void>;
  }
>()('shinsa/engine/versions/Versions') {
  static readonly layer = (input: VersionsInput) =>
    Layer.effect(
      Versions,
      Effect.gen(function* () {
        const config = yield* EngineConfig;
        const installs = yield* ProgramInstalls;
        const registry = yield* NpmRegistry;
        const runner = yield* UpdaterRunner;
        const latest = yield* Ref.make<ReadonlyMap<string, string>>(new Map());
        const running = yield* Ref.make<ReadonlySet<ProgramId>>(new Set());
        const checkedAt = yield* Ref.make<number | null>(null);
        const checking = yield* Semaphore.make(1);
        const stopped = yield* Deferred.make<void>();
        yield* Effect.addFinalizer(() => Deferred.succeed(stopped, undefined));

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
              registry.latest(name).pipe(
                Effect.flatMap((version) => Ref.update(latest, (known) => new Map(known).set(name, version))),
                Effect.catch((failure) =>
                  Effect.logWarning('[Versions] Could not read the latest version').pipe(
                    Effect.annotateLogs({ name, error: failure.message })
                  )
                )
              ),
            { concurrency: 'unbounded', discard: true }
          );
          yield* Ref.set(checkedAt, yield* Clock.currentTimeMillis);
        });

        const syncLatest = Semaphore.withPermit(
          checking,
          Effect.gen(function* () {
            const at = yield* Ref.get(checkedAt);
            if (at !== null && (yield* Clock.currentTimeMillis) - at < LATEST_TTL_MS) return;
            yield* readLatest;
          })
        );

        const readProgram = Effect.fn('Versions.readProgram')(function* (id: ProgramId) {
          const { label, package: name } = PROGRAMS[id];
          const { path, override } = yield* installs.locate(id);
          const minimum = yield* installs.minimum(id);
          const known = (yield* Ref.get(latest)).get(name) ?? null;
          const updating = (yield* Ref.get(running)).has(id);
          const base = { id, label, path, latest: known, minimum, override, updating };
          if (!path) {
            const missing: ProgramVersion = {
              ...base,
              version: null,
              status: 'not_installed',
              updater: null,
            };
            return missing;
          }
          if (override) {
            const overridden: ProgramVersion = { ...base, version: null, status: 'unknown', updater: null };
            return overridden;
          }
          const version = yield* installs.readVersion(id, path);
          const program: ProgramVersion = {
            ...base,
            version,
            status: resolveProgramStatus(version, known, minimum),
            updater: (yield* installs.updater(id, path)).label,
          };
          return program;
        });

        const snapshot = Effect.gen(function* () {
          yield* syncLatest;
          const programs = yield* Effect.forEach(PROGRAM_IDS, readProgram, { concurrency: 'unbounded' });
          const sdk = yield* installs.sdk;
          const versions: VersionsSnapshot = {
            programs,
            sdk: { name: SDK_PACKAGE, ...sdk, latest: (yield* Ref.get(latest)).get(SDK_PACKAGE) ?? null },
            latestCheckedAt: yield* Ref.get(checkedAt),
          };
          return versions;
        });

        const update = Effect.fn('Versions.update')(function* (
          id: ProgramId,
          path: string,
          onLine: LineListener
        ) {
          const { label } = PROGRAMS[id];
          const before = yield* installs.readVersion(id, path);
          const updater = yield* installs.updater(id, path);
          yield* Effect.logInfo('[Versions] Updating').pipe(
            Effect.annotateLogs({ program: id, command: updater.label })
          );
          const result = yield* runner.run(
            updater,
            (line) => {
              const clean = cleanOutputLine(line);
              if (clean) onLine(clean);
            },
            Deferred.await(stopped)
          );
          yield* release(id);
          if (!result.ok) {
            const message = describeRunFailure(label, result);
            yield* Effect.logWarning('[Versions] Update failed').pipe(
              Effect.annotateLogs({ program: id, reason: message })
            );
            const failed: UpdateOutcome = { ok: false, message, versions: yield* snapshot };
            return failed;
          }
          yield* input.onUpdated(id);
          const versions = yield* snapshot;
          const outcome: UpdateOutcome = { ...describeUpdated(yield* readProgram(id), before), versions };
          return outcome;
        });

        const startUpdate = Effect.fn('Versions.startUpdate')(function* (program: unknown) {
          if (!isProgramId(program))
            return yield* new DomainError({ code: 'program_invalid', message: 'Update claude or codex.' });
          const { label, overrideEnv } = PROGRAMS[program];
          if (config.inspect) return yield* createReadOnlyError();
          if ((yield* Ref.get(running)).has(program))
            return yield* new DomainError({
              code: 'update_running',
              message: `${label} is already updating.`,
            });
          const { path, override } = yield* installs.locate(program);
          if (!path)
            return yield* new DomainError({ code: 'program_missing', message: `${label} is not installed.` });
          if (override) {
            return yield* new DomainError({
              code: 'program_override',
              message: `Update ${label} yourself (${overrideEnv}).`,
            });
          }
          yield* Ref.update(running, (ids) => new Set(ids).add(program));
          const run: UpdateRun = (onLine) =>
            update(program, path, onLine).pipe(Effect.ensuring(release(program)));
          return run;
        });

        return Versions.of({
          snapshot,
          refresh: Effect.andThen(Ref.set(checkedAt, null), snapshot),
          startUpdate,
          stop: Deferred.succeed(stopped, undefined).pipe(Effect.asVoid),
        });
      })
    );
}
