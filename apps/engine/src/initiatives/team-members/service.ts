import { Context, Effect, Layer, type Scope, Semaphore } from 'effect';
import { RemoteStore } from '../../remote/store/service.ts';
import { TeamFeeds } from '../../remote/team-feeds/service.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import type { TeamMembersUpdate } from './schema.ts';
import { listTeamMembersUpdates, resolveTeamMembersId } from './updates.ts';

export class TeamMembers extends Context.Service<
  TeamMembers,
  {
    readonly sync: Effect.Effect<void>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()('shinsa/engine/initiatives/TeamMembers') {
  static readonly layer = Layer.effect(
    TeamMembers,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const feeds = yield* TeamFeeds;
      const store = yield* RemoteStore;
      const lock = yield* Semaphore.make(1);

      const record = (update: TeamMembersUpdate) =>
        engine
          .dispatch(
            {
              type: 'initiative.record_team_members',
              initiativeId: update.initiativeId,
              teamId: update.teamId,
              members: update.members,
            },
            { id: resolveTeamMembersId(update) }
          )
          .pipe(
            Effect.asVoid,
            Effect.catch((failure) =>
              Effect.logWarning('[Leads] Could not record a teammate’s tasks in an initiative').pipe(
                Effect.annotateLogs({ initiativeId: update.initiativeId, error: failure.message })
              )
            )
          );

      const sync = lock.withPermit(
        Effect.gen(function* () {
          const self = (yield* store.file).credentials?.instanceId;
          if (!self) return;
          const updates = listTeamMembersUpdates(yield* engine.state, self, yield* feeds.snapshot);
          yield* Effect.forEach(updates, record, { discard: true });
        })
      );

      return TeamMembers.of({ sync, start: Effect.andThen(feeds.observe(sync), sync) });
    })
  );
}
