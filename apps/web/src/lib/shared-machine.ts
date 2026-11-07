import type { Settings } from '@shinsa/core';

export const SHARED_MACHINE_TITLE = 'Shared machine';

export const SHARED_MACHINE_HINT =
  "Each member's tasks run on their own Claude accounts and GitHub token, and the lists show your own tasks first.";

export function describeSharedMachineSaved(shared: boolean) {
  return shared ? 'Shared machine is on.' : 'Shared machine is off.';
}

export function resolveSharedPatch(shared: boolean): Partial<Settings> {
  return { sharedMachine: shared };
}

export const GITHUB_TOKEN_LABEL = {
  title: 'Your GitHub token',
  saved: (login: string) => `Your tasks push and open pull requests as ${login}.`,
  missing: "Your tasks push with this machine's GitHub login until you add a token.",
  placeholder: 'ghp_… or github_pat_…',
  save: 'Save token',
  remove: 'Remove token',
  savedToast: 'Your GitHub token is saved.',
  removedToast: 'Your GitHub token is removed.',
} as const;

export function describeGitHubToken(answer: { saved: boolean; login: string | null }) {
  return answer.saved && answer.login ? GITHUB_TOKEN_LABEL.saved(answer.login) : GITHUB_TOKEN_LABEL.missing;
}

export function isGitHubTokenShown(answer: { machineLogin: boolean } | null, shared: boolean) {
  return shared && answer !== null && !answer.machineLogin;
}
