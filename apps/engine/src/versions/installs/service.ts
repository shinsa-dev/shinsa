import type { ProgramId } from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import {
  locateClaude,
  parseClaudeVersion,
  resolveSdkClaudeVersion,
  resolveSdkPackage,
} from '../../agents/providers/claude/executable.ts';
import {
  CODEX_MINIMUM_VERSION,
  locateCodex,
  parseCodexVersion,
} from '../../agents/providers/codex/executable.ts';
import type { ProgramLocation } from '../../agents/providers/versions/schema.ts';
import { ProgramVersions } from '../../agents/providers/versions/service.ts';
import type { SdkVersions, Updater } from '../schema.ts';
import { resolveUpdater } from '../updaters.ts';

export class ProgramInstalls extends Context.Service<
  ProgramInstalls,
  {
    locate(program: ProgramId): Effect.Effect<ProgramLocation>;
    readVersion(program: ProgramId, path: string): Effect.Effect<string | null>;
    minimum(program: ProgramId): Effect.Effect<string>;
    readonly sdk: Effect.Effect<SdkVersions>;
    updater(program: ProgramId, path: string): Effect.Effect<Updater>;
  }
>()('shinsa/engine/versions/installs/ProgramInstalls') {
  static readonly layer = Layer.effect(
    ProgramInstalls,
    Effect.gen(function* () {
      const versions = yield* ProgramVersions;
      return ProgramInstalls.of({
        locate: (program) => Effect.sync(() => (program === 'claude' ? locateClaude() : locateCodex())),
        readVersion: (program, path) =>
          versions.read(path, program === 'claude' ? parseClaudeVersion : parseCodexVersion),
        minimum: (program) =>
          Effect.sync(() => (program === 'claude' ? resolveSdkClaudeVersion() : CODEX_MINIMUM_VERSION)),
        sdk: Effect.sync(() => resolveSdkPackage()),
        updater: (program, path) => Effect.sync(() => resolveUpdater(program, path)),
      });
    })
  );
}
