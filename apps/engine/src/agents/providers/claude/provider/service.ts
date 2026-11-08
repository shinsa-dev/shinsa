import { CLAUDE_PROVIDER } from '@shinsa/core';
import { Context, Duration, Effect, FileSystem, Layer } from 'effect';
import { Shell } from '../../../../shell/service.ts';
import { COMPLETION_TIMEOUT_MS, ProviderCallFailed } from '../../schema.ts';
import type { AgentProvider, AgentSessionInput } from '../../types.ts';
import { resolveClaudeSessionStatus } from '../artifacts.ts';
import { makeClaudeCompletions } from '../complete/service.ts';
import { COMPACT_PROMPT } from '../context.ts';
import { CATALOG_TIMEOUT_MS } from '../models/schema.ts';
import { makeModelCatalog } from '../models/service.ts';
import { ClaudeSdk } from '../sdk/service.ts';
import { makeClaudeSession } from '../session/service.ts';
import { CLAUDE_CAPABILITIES, ClaudeProviderOptions } from './schema.ts';

export class ClaudeProvider extends Context.Service<ClaudeProvider, AgentProvider>()(
  'shinsa/engine/agents/providers/claude/ClaudeProvider'
) {
  static readonly layer = Layer.effect(
    ClaudeProvider,
    Effect.gen(function* () {
      const runtime = yield* ClaudeSdk;
      const options = yield* ClaudeProviderOptions;
      const shell = yield* Shell;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
      const catalog = yield* makeModelCatalog({ runtime, timeout: Duration.millis(CATALOG_TIMEOUT_MS) });
      const failed = (error: { readonly message: string }) =>
        new ProviderCallFailed({ provider: CLAUDE_PROVIDER, message: error.message });

      const startSession = Effect.fn('ClaudeProvider.startSession')(function* (input: AgentSessionInput) {
        const handle = yield* makeClaudeSession(input, { runtime, eunoe: options.eunoe }).pipe(
          Effect.provideService(Shell, shell)
        );
        return {
          done: handle.done,
          steer: (text: string, from: 'you' | 'shinsa' = 'you') => handle.steer(text, from),
          cancel: handle.cancel,
          hasPendingBackgroundWork: handle.hasPendingBackgroundWork,
          loadMcpServers: handle.loadMcpServers,
        };
      });

      return ClaudeProvider.of({
        id: CLAUDE_PROVIDER,
        label: 'Claude',
        capabilities: CLAUDE_CAPABILITIES,
        startSession,
        compactSession: (input) => startSession({ ...input, prompt: COMPACT_PROMPT }),
        inspectSession: (query) =>
          withFiles(resolveClaudeSessionStatus({ ...query, env: options.env, home: options.home })),
        listModels: catalog.list,
        complete: (request) =>
          makeClaudeCompletions(runtime).pipe(
            Effect.flatMap((completions) =>
              completions.text(request, Duration.millis(COMPLETION_TIMEOUT_MS))
            ),
            Effect.mapError(failed)
          ),
        completeStructured: (request) =>
          makeClaudeCompletions(runtime).pipe(
            Effect.flatMap((completions) => completions.structured(request)),
            Effect.mapError(failed)
          ),
      });
    })
  );
}
