import { Context } from 'effect';
import type { ProviderCapabilities } from '../../types.ts';
import type { EunoeLink } from '../route/schema.ts';

export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  sessions: { resume: true, inspect: true, fork: true },
  turns: { steering: true },
  approvals: true,
  planning: { readOnly: true },
  contextHandoff: true,
  structuredOutput: true,
  accounts: true,
  compaction: true,
  folds: true,
  fastMode: true,
};

export interface ClaudeProviderSettings {
  readonly eunoe: EunoeLink | null;
  readonly env?: Record<string, string | undefined>;
  readonly home?: string;
}

export const ClaudeProviderOptions = Context.Reference<ClaudeProviderSettings>(
  'shinsa/engine/agents/providers/claude/ClaudeProviderOptions',
  { defaultValue: () => ({ eunoe: null }) }
);
