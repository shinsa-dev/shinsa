import {
  type OnboardingCheck,
  type OnboardingPrompt,
  type OnboardingStatus,
  type RootSuggestion,
  resolveDisplayPath,
} from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';

interface FolderRow {
  path: string;
  label: string;
  removable: boolean;
}

interface FolderSuggestion {
  path: string;
  label: string;
  detail: string;
  chosen: boolean;
}

export function describeOnboardingStep(prompt: OnboardingPrompt | null) {
  if (!prompt) return 'Setup is done.';
  return `Question ${prompt.step} of ${prompt.steps}`;
}

export function listFolderRows(status: OnboardingStatus): FolderRow[] {
  const { userHome } = status.paths;
  const configured = status.roots.configured.map((path) => ({
    path,
    label: resolveDisplayPath(path, userHome),
    removable: true,
  }));
  const fromEnvironment = status.roots.fromEnvironment
    .filter((path) => !status.roots.configured.includes(path))
    .map((path) => ({ path, label: resolveDisplayPath(path, userHome), removable: false }));
  return [...configured, ...fromEnvironment];
}

export function listFolderSuggestions(status: OnboardingStatus, suggestions: RootSuggestion[]) {
  const chosen = new Set(status.roots.configured);
  return suggestions.map(
    (suggestion): FolderSuggestion => ({
      path: suggestion.path,
      label: resolveDisplayPath(suggestion.path, status.paths.userHome),
      detail: formatCount(suggestion.repoCount, 'repository', 'repositories'),
      chosen: chosen.has(suggestion.path),
    })
  );
}

export function resolveToggledRoots(configured: string[], path: string) {
  return configured.includes(path) ? configured.filter((root) => root !== path) : [...configured, path];
}

export function resolveCheckOutcome(check: OnboardingCheck) {
  if (check.ok) return 'pass';
  return check.optional ? 'skipped' : 'fail';
}
