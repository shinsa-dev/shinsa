import type { AgentRole } from './types.ts';

export interface Settings {
  defaultProvider: string;
  defaultModel: string | null;
  maxFixRounds: number | null;
  mergeMethod: 'squash' | 'merge' | 'rebase';
  worktreesDirectory: string;
  attentionLimit?: number;
  approvePlans?: boolean;
  agentModels?: Partial<Record<AgentRole, string>>;
}

export const DEFAULT_MODEL = 'opus';

export const DEFAULT_ATTENTION_LIMIT = 1;

export const DEFAULT_SETTINGS: Settings = {
  defaultProvider: 'claude',
  defaultModel: DEFAULT_MODEL,
  maxFixRounds: null,
  mergeMethod: 'squash',
  worktreesDirectory: '~/.shinsa/worktrees',
  attentionLimit: DEFAULT_ATTENTION_LIMIT,
  approvePlans: false,
  agentModels: {},
};

export function createSettings(): Settings {
  return structuredClone(DEFAULT_SETTINGS);
}

export function resolveAttentionLimit(settings: Settings) {
  return Math.max(1, settings.attentionLimit ?? DEFAULT_ATTENTION_LIMIT);
}
