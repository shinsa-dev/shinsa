import { query } from '@anthropic-ai/claude-agent-sdk';
import { Context, Effect, Layer } from 'effect';
import { ProgramVersions } from '../../versions/service.ts';
import { resolveClaudeExecutable } from '../executable.ts';
import type { ClaudeRuntime } from './schema.ts';

export class ClaudeSdk extends Context.Service<ClaudeSdk, ClaudeRuntime>()(
  'shinsa/engine/agents/providers/claude/ClaudeSdk'
) {
  static readonly layer = Layer.effect(
    ClaudeSdk,
    Effect.gen(function* () {
      const versions = yield* ProgramVersions;
      return ClaudeSdk.of({
        runQuery: query,
        resolveExecutable: resolveClaudeExecutable().pipe(Effect.provideService(ProgramVersions, versions)),
      });
    })
  );
}
