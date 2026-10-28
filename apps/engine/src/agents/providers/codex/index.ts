import { CODEX_PROVIDER } from '@shinsa/core';
import type { AgentProvider, ProviderCapabilities } from '../types.ts';
import { requestCodexCompletion, requestCodexStructured } from './complete.ts';
import { readCodexLogin } from './login.ts';
import { CodexModelCatalog } from './models.ts';
import { CODEX_RUNTIME, type CodexRuntime, type CodexSessionOptions, startCodexSession } from './session.ts';
import { type CodexUsageOptions, readCodexUsage } from './usage.ts';

export const CODEX_CAPABILITIES: ProviderCapabilities = {
  sessions: { resume: true, inspect: false, fork: true },
  turns: { steering: true },
  approvals: true,
  planning: { readOnly: true },
  contextHandoff: true,
  structuredOutput: true,
  accounts: false,
  compaction: true,
  fastMode: true,
};

export function createCodexProvider(
  runtime: CodexRuntime = CODEX_RUNTIME,
  options: Omit<CodexSessionOptions, 'runtime'> = {},
  usage: CodexUsageOptions = { env: runtime.env }
): AgentProvider {
  const catalog = new CodexModelCatalog(runtime);
  return {
    id: CODEX_PROVIDER,
    label: 'Codex',
    capabilities: CODEX_CAPABILITIES,
    startSession: (input) => startCodexSession(input, { ...options, runtime }),
    compactSession: (input) =>
      startCodexSession({ ...input, prompt: '' }, { ...options, runtime }, 'compact'),
    listModels: () => catalog.list(),
    complete: (request) => requestCodexCompletion(request, runtime),
    completeStructured: (request) => requestCodexStructured(request, runtime),
    readLogin: () => readCodexLogin(runtime),
    readUsage: () => readCodexUsage(runtime, usage),
  };
}
