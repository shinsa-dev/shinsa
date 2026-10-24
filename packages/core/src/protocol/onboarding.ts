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

export type OnboardingQuestionId = 'roots' | 'model' | 'merge' | 'plans' | 'accounts' | 'prerequisites';

export interface OnboardingCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  fix: string | null;
  optional?: boolean;
}

export interface OnboardingMessage {
  id: string;
  from: 'shinsa' | 'you';
  text: string;
  problem: boolean;
  checks: OnboardingCheck[];
}

export interface OnboardingChoice {
  value: string;
  label: string;
  detail: string | null;
  chosen: boolean;
}

export interface OnboardingPrompt {
  questionId: OnboardingQuestionId;
  step: number;
  steps: number;
  mode: 'answer' | 'confirm';
  multiple: boolean;
  choices: OnboardingChoice[];
  submitLabel: string | null;
  placeholder: string;
}

export interface OnboardingChat {
  messages: OnboardingMessage[];
  prompt: OnboardingPrompt | null;
}

export type OnboardingReply =
  | { type: 'choose'; questionId: OnboardingQuestionId; values: string[] }
  | { type: 'say'; questionId: OnboardingQuestionId; text: string }
  | { type: 'restart' };

export function resolveDisplayPath(path: string, userHome: string) {
  const home = userHome.replace(/\/+$/, '');
  if (!home) return path;
  if (path === home) return '~';
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
