import type { TaskOwner } from '@shinsa/core';
import { Context, type Effect, Schema } from 'effect';

export const GitHubIdentity = Schema.Struct({
  token: Schema.String,
  login: Schema.String,
  name: Schema.String,
  email: Schema.String,
});
export type GitHubIdentity = typeof GitHubIdentity.Type;

export const GitHubUser = Schema.Struct({
  id: Schema.Number,
  login: Schema.String,
  name: Schema.NullOr(Schema.String),
});

export interface TaskGitHubShape {
  readonly identity: GitHubIdentity | null;
  readonly missing: TaskOwner | null;
}

export const MACHINE_LOGIN: TaskGitHubShape = { identity: null, missing: null };

export const TaskGitHub = Context.Reference<TaskGitHubShape>('shinsa/engine/github/identity/TaskGitHub', {
  defaultValue: () => MACHINE_LOGIN,
});

export interface MachineGitHubShape {
  readonly machineOwner: Effect.Effect<string | null>;
  selectToken(login: string): Effect.Effect<GitHubIdentity | null>;
}

export const MachineGitHub = Context.Reference<MachineGitHubShape | null>(
  'shinsa/engine/github/identity/MachineGitHub',
  { defaultValue: () => null }
);

export const GITHUB_HEADER_KEY = 'http.https://github.com/.extraheader';

export const NO_REPLY_DOMAIN = 'users.noreply.github.com';

export const MAX_GITHUB_TOKEN = 400;

export const GITHUB_TOKEN_INVALID = {
  code: 'github_token_invalid',
  message: 'Paste a GitHub token, or send null to remove yours.',
} as const;

export const GITHUB_TOKEN_REFUSED = {
  code: 'github_token_refused',
  message: 'GitHub did not accept that token. Check that it has not expired and has the repo scope.',
} as const;

export const GITHUB_TOKEN_MACHINE = {
  code: 'github_token_machine',
  message: "Your tasks push with this machine's own GitHub login, so it needs no token from you.",
} as const;

export const GITHUB_TOKEN_NO_OWNER = {
  code: 'github_token_no_owner',
  message: 'Turn on remote access first, so this machine knows whose token it is.',
} as const;
