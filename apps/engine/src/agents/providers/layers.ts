import { Layer } from 'effect';
import { ClaudeProvider } from './claude/provider/service.ts';
import { ClaudeSdk } from './claude/sdk/service.ts';
import { CodexCli } from './codex/cli/service.ts';
import { CodexProvider } from './codex/provider/service.ts';
import { Providers } from './registry/service.ts';
import { ProgramVersions } from './versions/service.ts';

export const ProvidersLayer = Providers.layer.pipe(
  Layer.provide(Layer.mergeAll(ClaudeProvider.layer, CodexProvider.layer)),
  Layer.provide(Layer.mergeAll(ClaudeSdk.layer, CodexCli.layer)),
  Layer.provide(ProgramVersions.layer)
);
