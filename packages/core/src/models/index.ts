import type { Settings } from '../model/settings.ts';
import type { AgentRole, RunRole } from '../model/types.ts';

export interface AgentModel {
  id: string;
  label: string;
  description: string;
}

export const KNOWN_AGENT_MODELS: AgentModel[] = [
  { id: 'opus', label: 'Opus 5.5', description: '' },
  { id: 'fable', label: 'Fable 5.1', description: '' },
  { id: 'sonnet', label: 'Sonnet 5.5', description: '' },
  { id: 'haiku', label: 'Haiku 4.5', description: '' },
];

export const DEFAULT_AGENT_MODELS: Record<AgentRole, string> = {
  classifier: 'haiku',
  planner: 'opus',
  builder: 'opus',
  reviewer: 'opus',
  fixer: 'opus',
  writer: 'haiku',
};

export const RUN_AGENT_ROLE: Record<RunRole, AgentRole> = {
  triage: 'classifier',
  planner: 'planner',
  builder: 'builder',
  reviewer: 'reviewer',
  fixer: 'fixer',
  shipper: 'fixer',
};

export function resolveAgentModel(settings: Settings, role: AgentRole) {
  const chosen = settings.agentModels?.[role];
  if (chosen) return chosen;
  if (role === 'classifier' || role === 'writer') return DEFAULT_AGENT_MODELS[role];
  return settings.defaultModel ?? DEFAULT_AGENT_MODELS[role];
}

function stripContextSuffix(modelId: string) {
  return modelId.replace(/\[.*\]$/, '');
}

export function resolveModelFamily(modelId: string) {
  const bare = stripContextSuffix(modelId);
  return /^claude-([a-z]+)/.exec(bare)?.[1] ?? bare;
}

export function resolveModelLabel(modelId: string) {
  const known = KNOWN_AGENT_MODELS.find((model) => model.id === modelId);
  if (known) return known.label;
  const bare = stripContextSuffix(modelId);
  const match = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(bare);
  const family = match?.[1] ?? resolveModelFamily(bare);
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  if (!match?.[2]) return name;
  return match[3] ? `${name} ${match[2]}.${match[3]}` : `${name} ${match[2]}`;
}
