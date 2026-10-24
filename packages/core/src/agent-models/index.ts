import { capitalise } from '../chat/text.ts';
import type { Settings } from '../domain/settings.ts';
import type { AgentRole, RunRole } from '../domain/types.ts';

export interface AgentModel {
  id: string;
  label: string;
  description: string;
}

export interface AgentProviderInfo {
  id: string;
  label: string;
  models: AgentModel[];
}

export const CLAUDE_PROVIDER = 'claude';

export const CODEX_PROVIDER = 'codex';

export const KNOWN_AGENT_MODELS: AgentModel[] = [
  { id: 'opus', label: 'Opus 5.5', description: '' },
  { id: 'fable', label: 'Fable 5.1', description: '' },
  { id: 'sonnet', label: 'Sonnet 5.5', description: '' },
  { id: 'haiku', label: 'Haiku 4.5', description: '' },
];

export const KNOWN_CODEX_MODELS: AgentModel[] = [
  { id: 'gpt-6-astra', label: 'GPT-6-Astra', description: '' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6-Sol', description: '' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6-Terra', description: '' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6-Luna', description: '' },
];

export const KNOWN_AGENT_PROVIDERS: AgentProviderInfo[] = [
  { id: CLAUDE_PROVIDER, label: 'Claude', models: KNOWN_AGENT_MODELS },
  { id: CODEX_PROVIDER, label: 'Codex', models: KNOWN_CODEX_MODELS },
];

export const AGENT_ROLES: readonly AgentRole[] = [
  'classifier',
  'planner',
  'builder',
  'reviewer',
  'fixer',
  'answerer',
  'writer',
];

const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  classifier: 'sonnet',
  planner: 'opus',
  builder: 'opus',
  reviewer: 'opus',
  fixer: 'opus',
  answerer: 'opus',
  writer: 'sonnet',
};

const DEFAULT_CODEX_MODELS: Record<AgentRole, string> = {
  classifier: 'gpt-5.6-luna',
  planner: 'gpt-6-astra',
  builder: 'gpt-6-astra',
  reviewer: 'gpt-6-astra',
  fixer: 'gpt-6-astra',
  answerer: 'gpt-6-astra',
  writer: 'gpt-5.6-luna',
};

const PROVIDER_DEFAULT_MODELS: Record<string, Record<AgentRole, string>> = {
  [CLAUDE_PROVIDER]: DEFAULT_AGENT_MODELS,
  [CODEX_PROVIDER]: DEFAULT_CODEX_MODELS,
};

export const RUN_AGENT_ROLE: Record<RunRole, AgentRole> = {
  planner: 'planner',
  builder: 'builder',
  reviewer: 'reviewer',
  fixer: 'fixer',
  answerer: 'answerer',
  investigator: 'answerer',
  researcher: 'answerer',
  operator: 'builder',
};

export function resolveAgentProvider(settings: Settings, role: AgentRole) {
  return settings.agentProviders?.[role] || settings.defaultProvider;
}

const WORKING_ROLES: readonly AgentRole[] = ['planner', 'builder', 'reviewer', 'fixer', 'answerer'];

export function listAgentProviders(settings: Settings) {
  return [...new Set(WORKING_ROLES.map((role) => resolveAgentProvider(settings, role)))];
}

function isQuickRole(role: AgentRole) {
  return role === 'classifier' || role === 'writer';
}

export function resolveAgentModel(
  settings: Settings,
  role: AgentRole,
  provider: string = resolveAgentProvider(settings, role)
) {
  const chosen = settings.agentModels?.[role];
  if (chosen && provider === resolveAgentProvider(settings, role)) return chosen;
  const defaults = PROVIDER_DEFAULT_MODELS[provider] ?? DEFAULT_AGENT_MODELS;
  if (isQuickRole(role) || provider !== settings.defaultProvider) return defaults[role];
  return settings.defaultModel || defaults[role];
}

export function resolveProviderLabel(providerId: string) {
  return KNOWN_AGENT_PROVIDERS.find((provider) => provider.id === providerId)?.label ?? providerId;
}

function stripContextSuffix(modelId: string) {
  return modelId.replace(/\[.*\]$/, '');
}

export function resolveModelFamily(modelId: string) {
  const bare = stripContextSuffix(modelId);
  return /^claude-([a-z]+)/.exec(bare)?.[1] ?? bare;
}

export function resolveModelLabel(modelId: string) {
  const known = KNOWN_AGENT_PROVIDERS.flatMap((provider) => provider.models).find(
    (model) => model.id === modelId
  );
  if (known) return known.label;
  const bare = stripContextSuffix(modelId);
  if (bare.startsWith('gpt-')) return `GPT-${bare.slice(4).split('-').map(capitalise).join('-')}`;
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(bare);
  const name = capitalise(match?.[1] ?? resolveModelFamily(bare));
  if (!match?.[2]) return name;
  return match[3] ? `${name} ${match[2]}.${match[3]}` : `${name} ${match[2]}`;
}
