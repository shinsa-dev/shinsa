import {
  type AccountImport,
  type AccountSummary,
  describeList,
  type OnboardingCheck,
  type OnboardingFlow,
  type OnboardingOption,
  type OnboardingStatus,
  type OnboardingStep,
  type OnboardingStepEntry,
  type RootSuggestion,
  resolveDisplayPath,
  resolvePlanLabel,
} from '@shinsa/core';
import { formatCount } from '@/lib/format/count.ts';
import type { Route } from '@/router.ts';

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

export type StepDirection = 'forward' | 'back';

export type HighlightKey = 'ArrowDown' | 'ArrowUp' | 'Home' | 'End';

const HIGHLIGHT_KEYS = new Set<string>(['ArrowDown', 'ArrowUp', 'Home', 'End']);

const ACCOUNT_ORIGIN: Record<AccountSummary['origin'], string> = {
  claude: 'Your Claude Code login',
  cswap: 'From claude-swap',
  login: 'Signed in through Shinsa',
};

export function resolveOnboardingRedirect(route: Route, status: OnboardingStatus | null) {
  if (status?.completed !== false || route.name === 'onboarding') return null;
  return '/onboarding';
}

export function describeStepPosition(flow: OnboardingFlow) {
  return `Step ${Math.min(flow.index + 1, flow.steps.length)} of ${flow.steps.length}`;
}

export function describeStepHeading(flow: OnboardingFlow) {
  const entry = flow.steps[flow.index];
  const position = describeStepPosition(flow);
  return entry ? `${position}: ${entry.label}` : position;
}

export function resolveStepDirection(before: number | null, after: number): StepDirection {
  return before !== null && after < before ? 'back' : 'forward';
}

export function listChosenValues(step: OnboardingStep) {
  return step.options.filter((option) => option.chosen).map((option) => option.value);
}

export function isHighlightKey(key: string): key is HighlightKey {
  return HIGHLIGHT_KEYS.has(key);
}

export function resolveNextHighlight(current: number, key: HighlightKey, count: number) {
  if (key === 'Home' || (current < 0 && key === 'ArrowDown')) return 0;
  if (key === 'End' || (current < 0 && key === 'ArrowUp')) return count - 1;
  if (key === 'ArrowDown') return Math.min(current + 1, count - 1);
  return Math.max(current - 1, 0);
}

export function resolveFolderOptions(options: OnboardingOption[], typed: string[], userHome: string) {
  const known = new Set(options.map((option) => option.value));
  const added = typed
    .filter((path) => !known.has(path))
    .map((path) => ({
      value: path,
      label: resolveDisplayPath(path, userHome),
      detail: null,
      chosen: true,
      recommended: false,
    }));
  return [...options, ...added];
}

export function isImportedNow(account: AccountSummary, imported: AccountImport[]) {
  return imported.some((entry) => entry.email.toLowerCase() === account.email?.toLowerCase());
}

export function describeAccountSource(account: AccountSummary) {
  const plan = resolvePlanLabel(account.plan);
  const parts = [ACCOUNT_ORIGIN[account.origin]];
  if (account.signIn === 'signed_out') parts.push('Signed out');
  else if (plan) parts.push(`${plan} plan`);
  return parts.join(' · ');
}

export type StepState = 'done' | 'current' | 'ahead' | 'upcoming';

export function resolveStepState(entry: OnboardingStepEntry, index: number, current: number): StepState {
  if (index === current) return 'current';
  if (!entry.reached) return 'upcoming';
  return index < current || entry.summary !== null ? 'done' : 'ahead';
}

export function listStepperItems(flow: OnboardingFlow) {
  return flow.steps.map((entry, index) => {
    const state = resolveStepState(entry, index, flow.index);
    return {
      value: entry.id,
      label: entry.label,
      hint: entry.summary ?? undefined,
      checked: state === 'done',
      disabled: state === 'upcoming',
    };
  });
}

export const SUBMIT_KEY = 'submit';

export const REFRESH_KEY = 'refresh';

export const ACCESS_KEY = 'access';

export function describeAccessTitle(access: string[], userHome: string) {
  const names = access.map((path) => resolveDisplayPath(path, userHome));
  return `macOS keeps ${describeList(names, 'and')} private`;
}

export function listReadableRoots(values: string[], access: string[], userHome: string) {
  const refused = new Set(access.map((path) => resolveDisplayPath(path, userHome)));
  return values.filter((value) => !refused.has(resolveDisplayPath(value.replace(/\/+$/, ''), userHome)));
}

export function resolveSubmitValues(step: OnboardingStep, values: string[]) {
  if (step.id === 'roots' || step.options.length > 0) return values;
  return ['continue'];
}

export function listSetupSummary(flow: OnboardingFlow) {
  return flow.steps.flatMap((entry) =>
    entry.summary === null ? [] : [{ id: entry.id, label: entry.label, summary: entry.summary }]
  );
}
