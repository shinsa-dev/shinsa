import { describe, expect, test } from 'bun:test';
import { chmodSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BunServices } from '@effect/platform-bun';
import { createState, type ShinsaState, type TaskOwner } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import {
  MachineGitHubLayer,
  provideTaskGitHub,
  resolveAuthorEnv,
  resolveGitTokenEnv,
  resolveTaskGitHub,
  serializeMachineLoginNote,
  verifyGitHubToken,
} from '../../src/github/identity/resolve.ts';
import {
  type GitHubIdentity,
  MACHINE_LOGIN,
  MachineGitHub,
  type MachineGitHubShape,
  TaskGitHub,
} from '../../src/github/identity/schema.ts';
import { GitHubProcess } from '../../src/github/process/service.ts';
import type { GitHubAnswer } from '../../src/github/schema.ts';
import { GitHubCli } from '../../src/github/service.ts';
import { Remote } from '../../src/remote/machine/service.ts';
import { SecretStore } from '../../src/secrets/store/service.ts';
import { Shell } from '../../src/shell/service.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';
import { createTask } from '../helpers/state.ts';

const KAI: TaskOwner = { login: 'kai', name: 'Kai Lane', avatarUrl: null };
const MONA: TaskOwner = { login: 'mona', name: null, avatarUrl: null };
const KAI_TOKEN: GitHubIdentity = {
  token: 'ghp_kai',
  login: 'kai',
  name: 'Kai Lane',
  email: '7+kai@users.noreply.github.com',
};

const machine: MachineGitHubShape = {
  machineOwner: Effect.succeed('owner'),
  selectToken: (login) => Effect.succeed(login === 'kai' ? KAI_TOKEN : null),
};

function createShared(shared: boolean, owners: Record<string, TaskOwner | null>): ShinsaState {
  const state = createState();
  state.settings = { ...state.settings, sharedTeams: shared ? ['team-1'] : [] };
  for (const [id, owner] of Object.entries(owners)) state.tasks[id] = createTask({ id, owner });
  return state;
}

const answered = (stdout: string, ok = true) => ({
  ok,
  code: ok ? 0 : 1,
  stdout,
  stderr: '',
  timedOut: false,
});

function runCli<A, E>(answer: GitHubAnswer, effect: (cli: GitHubCli['Service']) => Effect.Effect<A, E>) {
  const layer = GitHubCli.layer.pipe(Layer.provide(GitHubProcess.layerTest(answer)));
  return Effect.runPromise(GitHubCli.use(effect).pipe(Effect.provide(layer)));
}

describe('a task’s GitHub identity', () => {
  test('on a shared machine a member’s task takes their token, and one without a token is noted', async () => {
    const state = createShared(true, { a: KAI, b: MONA, c: null, d: { ...KAI, login: 'owner' } });
    const resolve = (taskId: string) => Effect.runPromise(resolveTaskGitHub(machine, state, taskId));
    expect(await resolve('a')).toEqual({ identity: KAI_TOKEN, missing: null });
    expect(await resolve('b')).toEqual({ identity: null, missing: MONA });
    expect(await resolve('c')).toEqual(MACHINE_LOGIN);
    expect(await resolve('d')).toEqual(MACHINE_LOGIN);
    expect(await resolve('gone')).toEqual(MACHINE_LOGIN);
  });

  test('a machine that is not shared, or has no token source, always uses its own login', async () => {
    const state = createShared(false, { a: KAI });
    expect(await Effect.runPromise(resolveTaskGitHub(machine, state, 'a'))).toEqual(MACHINE_LOGIN);
    const shared = createShared(true, { a: KAI });
    expect(await Effect.runPromise(resolveTaskGitHub(null, shared, 'a'))).toEqual(MACHINE_LOGIN);
  });

  test('provideTaskGitHub hands the identity to the work it wraps', async () => {
    const state = createShared(true, { a: KAI });
    const seen = await Effect.runPromise(
      Effect.service(TaskGitHub).pipe(provideTaskGitHub(machine, Effect.succeed(state), 'a'))
    );
    expect(seen.identity).toEqual(KAI_TOKEN);
    expect((await Effect.runPromise(Effect.service(TaskGitHub))).identity).toBeNull();
  });

  test('git gets the token as a GitHub header and the owner as the author, and the machine login through gh', () => {
    const basic = Buffer.from('x-access-token:ghp_kai').toString('base64');
    expect(resolveGitTokenEnv(KAI_TOKEN)).toEqual({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    });
    expect(resolveAuthorEnv(KAI_TOKEN)).toEqual({
      GIT_AUTHOR_NAME: 'Kai Lane',
      GIT_AUTHOR_EMAIL: '7+kai@users.noreply.github.com',
    });
    expect(resolveGitTokenEnv(null)).toEqual({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_0: '',
      GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
      GIT_CONFIG_VALUE_1: '!gh auth git-credential',
    });
    expect(resolveAuthorEnv(null)).toBeUndefined();
  });

  test('the note names the owner, or their login when they have no name', () => {
    expect(serializeMachineLoginNote(KAI)).toContain('because Kai Lane has not added a GitHub token');
    expect(serializeMachineLoginNote(MONA)).toContain('because mona has not added');
  });
});

describe('verifyGitHubToken', () => {
  test('keeps a token of the member’s own account with their name and no-reply address', async () => {
    const calls: string[][] = [];
    const identity = await runCli(
      (args) => {
        calls.push([...args]);
        return answered(JSON.stringify({ id: 7, login: 'Kai', name: null }));
      },
      (cli) => verifyGitHubToken(cli, 'ghp_kai', 'kai', '/tmp')
    );
    expect(calls).toEqual([['api', 'user']]);
    expect(identity).toEqual({
      token: 'ghp_kai',
      login: 'Kai',
      name: 'Kai',
      email: '7+Kai@users.noreply.github.com',
    });
  });

  test('refuses a token GitHub turns down, and one of another account', async () => {
    const refused = await runCli(
      () => answered('Bad credentials', false),
      (cli) => Effect.flip(verifyGitHubToken(cli, 'ghp_old', 'kai', '/tmp'))
    );
    expect(refused).toMatchObject({ code: 'github_token_refused' });
    const other = await runCli(
      () => answered(JSON.stringify({ id: 9, login: 'mona', name: 'Mona' })),
      (cli) => Effect.flip(verifyGitHubToken(cli, 'ghp_mona', 'kai', '/tmp'))
    );
    expect(other).toMatchObject({
      code: 'github_token_other_account',
      message: 'That token belongs to mona, not kai. Use a token from your own GitHub account.',
    });
  });
});

describe('gh with a task’s identity', () => {
  test('runs gh with the owner’s token, and with the machine’s own login otherwise', async () => {
    const bin = createTempDir();
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\nprintf "token=%s" "$GH_TOKEN"\n');
    chmodSync(join(bin, 'gh'), 0o755);
    const restore = overrideEnv({ PATH: `${bin}:/bin:/usr/bin`, GH_TOKEN: undefined });
    const layer = GitHubProcess.layer.pipe(Layer.provide(Shell.layer), Layer.provide(BunServices.layer));
    const run = (identity: GitHubIdentity | null) =>
      Effect.runPromise(
        GitHubProcess.use((gh) => gh.attempt(['api', 'user'], createTempDir())).pipe(
          Effect.provideService(TaskGitHub, { identity, missing: null }),
          Effect.provide(layer)
        )
      );
    try {
      expect((await run(KAI_TOKEN)).stdout).toBe('token=ghp_kai');
      expect((await run(null)).stdout).toBe('token=');
    } finally {
      restore();
    }
  });
});

describe('the machine’s GitHub layer', () => {
  const build = (owner: TaskOwner | null) => {
    const remote = {
      resolveActor: (userId: string | null) => Effect.succeed(userId === null ? owner : null),
    };
    const secrets = {
      selectGitHubToken: (login: string) =>
        Effect.succeed(login === 'kai' ? { ...KAI_TOKEN, savedAt: 5 } : null),
    };
    return Effect.runSync(
      Effect.gen(function* () {
        const github = yield* MachineGitHub;
        if (!github) throw new Error('no MachineGitHub');
        return {
          owner: yield* github.machineOwner,
          kai: yield* github.selectToken('kai'),
          mona: yield* github.selectToken('mona'),
        };
      }).pipe(
        Effect.provide(
          MachineGitHubLayer.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(Remote, remote as unknown as Remote['Service']),
                Layer.succeed(SecretStore, secrets as unknown as SecretStore['Service'])
              )
            )
          )
        )
      )
    );
  };

  test('names the machine’s owner and hands back a member’s stored token without its save time', () => {
    expect(build({ login: 'christo', name: null, avatarUrl: null })).toEqual({
      owner: 'christo',
      kai: KAI_TOKEN,
      mona: null,
    });
  });

  test('names no owner while remote access is off', () => {
    expect(build(null).owner).toBeNull();
  });
});
