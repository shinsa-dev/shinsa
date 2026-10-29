import type { ProjectSuggestion } from '../domain/project-suggestions.ts';
import type { Settings } from '../domain/settings.ts';

export interface OnboardingStatus {
  completed: boolean;
  completedAt: number | null;
  roots: {
    source: 'configured' | 'environment' | 'discovered';
    configured: string[];
    fromEnvironment: string[];
    effective: string[];
  };
  defaults: { model: string | null; mergeMethod: Settings['mergeMethod'] };
  paths: { home: string; configPath: string; dataDir: string; userHome: string };
}

export interface RootSuggestion {
  path: string;
  repoCount: number;
  repos: string[];
  chosen: boolean;
}

export interface RootSuggestions {
  suggestions: RootSuggestion[];
  truncated: boolean;
}

export type OnboardingStepId = 'roots' | 'projects' | 'defaults' | 'accounts' | 'prerequisites';

export interface OnboardingCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix: string | null;
  command: string | null;
  optional?: boolean;
}

export interface OnboardingOption {
  value: string;
  label: string;
  detail: string | null;
  chosen: boolean;
  recommended: boolean;
}

export type OnboardingChoiceGroupId = 'model' | 'merge' | 'plans';

export interface OnboardingChoiceGroup {
  id: OnboardingChoiceGroupId;
  label: string;
  options: OnboardingOption[];
}

export interface OnboardingStepEntry {
  id: OnboardingStepId;
  label: string;
  summary: string | null;
  reached: boolean;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  title: string;
  description: string;
  multiple: boolean;
  options: OnboardingOption[];
  groups: OnboardingChoiceGroup[];
  checks: OnboardingCheck[];
  ready: boolean;
  projects: ProjectSuggestion[];
  filed: ProjectSuggestion[];
  conversation: OnboardingProjectTurn[];
  problem: string | null;
  access: string[];
  submitLabel: string;
}

export interface OnboardingFlow {
  steps: OnboardingStepEntry[];
  index: number;
  step: OnboardingStep | null;
  revisit: boolean;
}

export interface OnboardingProjectTurn {
  request: string;
  reply: string;
}

export const ONBOARDING_REQUEST_LIMIT = 500;

export interface OnboardingProjectChoice {
  id: string;
  name: string;
  repos: string[];
}

export type OnboardingReply =
  | {
      type: 'answer';
      stepId: OnboardingStepId;
      values: string[];
      projects?: OnboardingProjectChoice[];
    }
  | { type: 'revise'; stepId: OnboardingStepId; text: string; projects?: OnboardingProjectChoice[] }
  | { type: 'open'; stepId: OnboardingStepId }
  | { type: 'restart' };

export function serializeChoiceValue(group: OnboardingChoiceGroupId, value: string) {
  return `${group}=${value}`;
}

export function parseChoiceValue(text: string) {
  const at = text.indexOf('=');
  if (at <= 0) return null;
  return { group: text.slice(0, at), value: text.slice(at + 1) };
}

export function resolveDisplayPath(path: string, userHome: string) {
  const home = userHome.replace(/\/+$/, '');
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
