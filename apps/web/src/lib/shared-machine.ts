export const SHARE_MACHINE_HINT =
  "Everyone in the team can use this machine, and each person's tasks run on their own Claude accounts and GitHub token.";

export const SHARED_LABEL = 'Shared';

export function describeShareMachine(machine: string, team: string, shared: boolean) {
  return shared
    ? {
        title: `Share ${machine} with ${team}?`,
        body: `Everyone in ${team} gets access to ${machine}, and their tasks run on their own accounts.`,
        action: 'Share machine',
        done: `Shared with ${team}.`,
      }
    : {
        title: `Stop sharing ${machine} with ${team}?`,
        body: `People who reach ${machine} only through ${team} lose access. Their tasks stay on it.`,
        action: 'Stop sharing',
        done: `Stopped sharing with ${team}.`,
      };
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
