import { Effect, Layer } from 'effect';
import { LiveRuns } from '../../src/agents/active/service.ts';
import { Transcripts } from '../../src/agents/transcripts/service.ts';
import { EngineConfig } from '../../src/config/service.ts';
import { createTestConfig } from '../helpers/index.ts';

export function createLiveRuns(overrides: Partial<LiveRuns['Service']> = {}) {
  const executed: { runId: string; prompt: string | null }[] = [];
  const service: LiveRuns['Service'] = {
    active: new Map(),
    execute: (runId, prompt) => Effect.sync(() => void executed.push({ runId, prompt })),
    listServerNames: () => Effect.succeed([]),
    ...overrides,
  };
  const transcripts = Transcripts.layer.pipe(Layer.provide(Layer.succeed(EngineConfig, createTestConfig())));
  return { service, executed, layer: Layer.merge(Layer.succeed(LiveRuns, service), transcripts) };
}
