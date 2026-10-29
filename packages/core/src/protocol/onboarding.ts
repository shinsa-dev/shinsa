import type { ProjectSuggestion } from '../domain/project-suggestions.ts';
import type { Settings } from '../domain/settings.ts';
import type { AccountImport } from './accounts.ts';

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

export type OnboardingStepId =
  | 'roots'
  | 'projects'
  | 'model'
  | 'merge'
  | 'plans'
  | 'accounts'
  | 'prerequisites';

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
  checks: OnboardingCheck[];
  ready: boolean;
  projects: ProjectSuggestion[];
  imported: AccountImport[];
  notes: string[];
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
  | { type: 'open'; stepId: OnboardingStepId }
  | { type: 'restart' };

export function resolveDisplayPath(path: string, userHome: string) {
  const home = userHome.replace(/\/+$/, '');
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
