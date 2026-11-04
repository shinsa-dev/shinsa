import { Context } from 'effect';
import type { ProviderCapabilities } from '../../types.ts';
import type { CodexUsageOptions } from '../usage/schema.ts';

export const CODEX_CAPABILITIES: ProviderCapabilities = {
  sessions: { resume: true, inspect: false, fork: true },
  turns: { steering: true },
  approvals: true,
  planning: { readOnly: true },
  contextHandoff: true,
  structuredOutput: true,
  accounts: false,
  compaction: true,
  folds: false,
  fastMode: true,
};

export interface CodexProviderSettings {
  readonly requestTimeoutMs?: number;
  readonly heartbeatMs?: number;
  readonly compactGraceMs?: number;
  readonly usage?: CodexUsageOptions;
}

export const CodexProviderOptions = Context.Reference<CodexProviderSettings>(
  'shinsa/engine/agents/providers/codex/CodexProviderOptions',
  { defaultValue: () => ({}) }
);
