import { DomainError, isSharedMachine, type ShinsaState, type TaskOwner } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { Remote } from '../../remote/machine/service.ts';
import { SecretStore } from '../../secrets/store/service.ts';
import type { CommandEnv } from '../../shell/schema.ts';
import type { GitHubCli } from '../service.ts';
import {
  GITHUB_HEADER_KEY,
  MachineGitHub,
  GITHUB_TOKEN_REFUSED,
  type GitHubIdentity,
  GitHubUser,
  MACHINE_LOGIN,
  type MachineGitHubShape,
  NO_REPLY_DOMAIN,
  TaskGitHub,
  type TaskGitHubShape,
} from './schema.ts';

export function resolveGitTokenEnv(identity: GitHubIdentity | null): CommandEnv | undefined {
  if (!identity) return undefined;
  const basic = Buffer.from(`x-access-token:${identity.token}`).toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: GITHUB_HEADER_KEY,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
  };
}

export function resolveAuthorEnv(identity: GitHubIdentity | null): CommandEnv | undefined {
  if (!identity) return undefined;
  return { GIT_AUTHOR_NAME: identity.name, GIT_AUTHOR_EMAIL: identity.email };
}

export function serializeMachineLoginNote(owner: TaskOwner) {
  return `This machine's own GitHub login opened this pull request, because ${owner.name ?? owner.login} has not added a GitHub token on it.`;
}

export const resolveTaskGitHub = Effect.fn('resolveTaskGitHub')(function* (
  machine: MachineGitHubShape | null,
  state: ShinsaState,
  taskId: string
) {
  if (!machine || !isSharedMachine(state.settings)) return MACHINE_LOGIN;
  const owner = state.tasks[taskId]?.owner ?? null;
  if (!owner || owner.login === (yield* machine.machineOwner)) return MACHINE_LOGIN;
  const identity = yield* machine.selectToken(owner.login);
  const found: TaskGitHubShape = identity ? { identity, missing: null } : { identity: null, missing: owner };
  return found;
});

export const provideTaskGitHub =
  (machine: MachineGitHubShape | null, state: Effect.Effect<ShinsaState>, taskId: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.flatMap(
      Effect.flatMap(state, (current) => resolveTaskGitHub(machine, current, taskId)),
      (found) => Effect.provideService(effect, TaskGitHub, found)
    );

export const verifyGitHubToken = Effect.fn('verifyGitHubToken')(function* (
  cli: GitHubCli['Service'],
  token: string,
  login: string,
  cwd: string
) {
  const probe: GitHubIdentity = { token, login, name: login, email: '' };
  const user = yield* cli.json(GitHubUser, ['api', 'user'], cwd).pipe(
    Effect.provideService(TaskGitHub, { identity: probe, missing: null }),
    Effect.mapError(() => new DomainError(GITHUB_TOKEN_REFUSED))
  );
  if (user.login.toLowerCase() !== login.toLowerCase()) {
    return yield* new DomainError({
      code: 'github_token_other_account',
      message: `That token belongs to ${user.login}, not ${login}. Use a token from your own GitHub account.`,
    });
  }
  const identity: GitHubIdentity = {
    token,
    login: user.login,
    name: user.name ?? user.login,
    email: `${user.id}+${user.login}@${NO_REPLY_DOMAIN}`,
  };
  return identity;
});

export function resolveMachineOwner(remote: Remote['Service']) {
  return Effect.map(remote.resolveActor(null), (owner) => owner?.login ?? null);
}

export const MachineGitHubLayer = Layer.effect(
  MachineGitHub,
  Effect.gen(function* () {
    const remote = yield* Remote;
    const secrets = yield* SecretStore;
    return {
      machineOwner: resolveMachineOwner(remote),
      selectToken: (login: string) =>
        Effect.map(secrets.selectGitHubToken(login), (stored) =>
          stored ? { token: stored.token, login: stored.login, name: stored.name, email: stored.email } : null
        ),
    };
  })
);
