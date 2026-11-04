import { Context, Effect, Layer } from 'effect';
import { ProgramVersions } from '../../versions/service.ts';
import { resolveCodexExecutable } from '../executable.ts';
import type { CodexRuntime } from '../session/schema.ts';

export class CodexCli extends Context.Service<CodexCli, CodexRuntime>()(
  'shinsa/engine/agents/providers/codex/CodexCli'
) {
  static readonly layer = Layer.effect(
    CodexCli,
    Effect.gen(function* () {
      const versions = yield* ProgramVersions;
      return CodexCli.of({
        resolveExecutable: resolveCodexExecutable().pipe(Effect.provideService(ProgramVersions, versions)),
      });
    })
  );
}
