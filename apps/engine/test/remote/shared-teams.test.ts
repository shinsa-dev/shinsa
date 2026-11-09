import { describe, expect, test } from 'bun:test';
import { createState, DomainError } from '@shinsa/core';
import { Effect, Layer } from 'effect';
import { Remote } from '../../src/remote/machine/service.ts';
import { SharedTeams } from '../../src/remote/shared-teams/service.ts';
import { EngineCore } from '../../src/runtime/engine/service.ts';

describe('keeping shared teams in step', () => {
  test('each change to remote access gives the shared teams’ newcomers the machine', async () => {
    const synced: (readonly string[])[] = [];
    const listeners: Effect.Effect<void>[] = [];
    const state = createState();
    state.settings = { ...state.settings, sharedTeams: ['team-1'] };
    const remote = {
      syncSharedTeams: (teamIds: readonly string[]) =>
        Effect.sync(() => {
          synced.push(teamIds);
          return [] as string[];
        }),
      observe: (listener: Effect.Effect<void>) => Effect.sync(() => void listeners.push(listener)),
    };
    const engine = { state: Effect.succeed(state) };
    await Effect.runPromise(
      Effect.gen(function* () {
        const shared = yield* SharedTeams;
        yield* shared.sync;
        for (const listener of listeners) yield* listener;
        yield* Effect.yieldNow;
      }).pipe(
        Effect.provide(
          SharedTeams.layer.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(Remote, remote as unknown as Remote['Service']),
                Layer.succeed(EngineCore, engine as unknown as EngineCore['Service'])
              )
            )
          )
        )
      )
    );
    expect(synced).toEqual([['team-1'], ['team-1']]);
  });

  test('a machine shared with no team syncs an empty list', async () => {
    const synced: (readonly string[])[] = [];
    const state = createState();
    state.settings = { ...state.settings, sharedTeams: undefined };
    const remote = {
      syncSharedTeams: (teamIds: readonly string[]) =>
        Effect.sync(() => {
          synced.push(teamIds);
          return [] as string[];
        }),
      observe: () => Effect.void,
    };
    await Effect.runPromise(
      Effect.flatMap(SharedTeams, (shared) => shared.sync).pipe(
        Effect.provide(
          SharedTeams.layer.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(Remote, remote as unknown as Remote['Service']),
                Layer.succeed(EngineCore, {
                  state: Effect.succeed(state),
                } as unknown as EngineCore['Service'])
              )
            )
          )
        )
      )
    );
    expect(synced).toEqual([[]]);
  });

  test('a team the machine is no longer in stops counting as shared, and its grants go', async () => {
    const state = createState();
    state.settings = { ...state.settings, sharedTeams: ['team-1', 'gone'] };
    const unshared: string[] = [];
    const dispatched: unknown[] = [];
    const remote = {
      syncSharedTeams: () => Effect.succeed(['gone']),
      unshareTeam: (teamId: string) => Effect.sync(() => void unshared.push(teamId)),
      observe: () => Effect.void,
    };
    const engine = {
      state: Effect.sync(() => state),
      dispatch: (command: { patch: { sharedTeams: string[] } }) =>
        Effect.sync(() => {
          dispatched.push(command);
          state.settings = { ...state.settings, sharedTeams: command.patch.sharedTeams };
          return [];
        }),
    };
    await runSync(remote, engine);
    expect(dispatched).toEqual([{ type: 'settings.change', patch: { sharedTeams: ['team-1'] } }]);
    expect(unshared).toEqual(['gone']);
  });

  test('a failure to forget a team it left is only logged', async () => {
    const state = createState();
    state.settings = { ...state.settings, sharedTeams: ['gone'] };
    const remote = {
      syncSharedTeams: () => Effect.succeed(['gone']),
      unshareTeam: () => Effect.void,
      observe: () => Effect.void,
    };
    const engine = {
      state: Effect.succeed(state),
      dispatch: () => Effect.fail(new DomainError({ code: 'invalid', message: 'No.' })),
    };
    await runSync(remote, engine);
    expect(state.settings.sharedTeams).toEqual(['gone']);
  });
});

function runSync(remote: object, engine: object) {
  return Effect.runPromise(
    Effect.flatMap(SharedTeams, (shared) => shared.sync).pipe(
      Effect.provide(
        SharedTeams.layer.pipe(
          Layer.provide(
            Layer.merge(
              Layer.succeed(Remote, remote as unknown as Remote['Service']),
              Layer.succeed(EngineCore, engine as unknown as EngineCore['Service'])
            )
          )
        )
      )
    )
  );
}
