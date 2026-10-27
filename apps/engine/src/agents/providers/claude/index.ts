import { CLAUDE_PROVIDER } from '@shinsa/core';
import type { AgentProvider, ProviderCapabilities } from '../types.ts';
import { resolveClaudeSessionStatus } from './artifacts.ts';
import { requestClaudeCompletion, requestClaudeStructured } from './complete.ts';
import { COMPACT_PROMPT } from './context.ts';
import { ModelCatalog } from './models.ts';
import type { EunoeLink } from './route.ts';
import { CLAUDE_RUNTIME, type ClaudeRuntime } from './sdk.ts';
import { startClaudeSession } from './session.ts';

export { mapClaudeTool } from './map.ts';
export type { EunoeLink, EunoeListener, EunoeMode, EunoeStatus } from './route.ts';

export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  sessions: { resume: true, inspect: true },
  turns: { steering: true },
  approvals: true,
  planning: { readOnly: true },
  contextHandoff: true,
  structuredOutput: true,
  accounts: true,
  compaction: true,
  fastMode: true,
};

export interface ClaudeProviderOptions {
  env?: Record<string, string | undefined>;
  home?: string;
  eunoe?: EunoeLink | null;
}

export function createClaudeProvider(
  runtime: ClaudeRuntime = CLAUDE_RUNTIME,
  options: ClaudeProviderOptions = {}
): AgentProvider {
  const { eunoe = null, ...artifacts } = options;
  const catalog = new ModelCatalog(runtime);
  return {
    id: CLAUDE_PROVIDER,
    label: 'Claude',
    capabilities: CLAUDE_CAPABILITIES,
    startSession: (input) => startClaudeSession(input, { runtime, eunoe }),
    compactSession: (input) => startClaudeSession({ ...input, prompt: COMPACT_PROMPT }, { runtime, eunoe }),
    inspectSession: (query) => Promise.resolve(resolveClaudeSessionStatus({ ...query, ...artifacts })),
    listModels: () => catalog.list(),
    complete: (request) => requestClaudeCompletion(request, runtime),
    completeStructured: (request) => requestClaudeStructured(request, runtime),
  };
}
