import { listTeamProjectIds, type RemoteSnapshot, type ShinsaState } from '@shinsa/core';
import { Effect } from 'effect';
import { describeFailure } from '@/lib/connection/commands.ts';
import { connection, sendCommand } from '@/lib/connection/socket.ts';
import { runApp } from '@/lib/runtime/app.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { listTeamProjectCommands } from '@/lib/teams/settings.ts';
import { CommandFailed } from './schema.ts';

type TeamEndpoints = EngineClient['Service']['teams'];

const writeProjects = Effect.fn('Teams.writeProjects')(function* (
  state: ShinsaState,
  teamId: string,
  projectIds: readonly string[]
) {
  for (const command of listTeamProjectCommands(state, teamId, projectIds))
    yield* Effect.tryPromise({
      try: () => sendCommand(command),
      catch: (error) => new CommandFailed({ message: describeFailure(error) }),
    });
});

const create = Effect.fn('Teams.create')(function* (
  state: ShinsaState,
  name: string,
  projectIds: readonly string[]
) {
  const engine = yield* EngineClient;
  const created = yield* engine.teams.create({ payload: { name } });
  yield* writeProjects(state, created.teamId, projectIds);
  return created;
});

const join = Effect.fn('Teams.join')(function* (
  state: ShinsaState,
  url: string,
  projectIds: readonly string[]
) {
  const engine = yield* EngineClient;
  const joined = yield* engine.teams.join({ payload: { url } });
  const shared = listTeamProjectIds(state, joined.teamId);
  yield* writeProjects(state, joined.teamId, [...shared, ...projectIds]);
  return joined;
});

const readLink = Effect.fn('Teams.readLink')(function* (teamId: string) {
  const engine = yield* EngineClient;
  return yield* engine.teams.link({ payload: { teamId } });
});

const grantAccess = Effect.fn('Teams.grantAccess')(function* (teamId: string, userId: string) {
  const engine = yield* EngineClient;
  const snapshot = yield* engine.remote.grantMember({ payload: { teamId, userId } });
  connection.replaceRemote(snapshot);
  return snapshot;
});

function act(call: (teams: TeamEndpoints) => Effect.Effect<RemoteSnapshot, Error>) {
  return runApp(
    Effect.gen(function* () {
      const engine = yield* EngineClient;
      const snapshot = yield* call(engine.teams);
      connection.replaceRemote(snapshot);
      return snapshot;
    })
  );
}

export const TEAM_ACTIONS = {
  create: (state: ShinsaState, name: string, projectIds: readonly string[]) =>
    runApp(create(state, name, projectIds)),
  join: (state: ShinsaState, url: string, projectIds: readonly string[]) =>
    runApp(join(state, url, projectIds)),
  writeProjects: (state: ShinsaState, teamId: string, projectIds: readonly string[]) =>
    runApp(writeProjects(state, teamId, projectIds)),
  readLink: (teamId: string) => runApp(readLink(teamId)),
  removeLink: (teamId: string) => act((teams) => teams.removeLink({ payload: { teamId } })),
  acceptRequest: (teamId: string, userId: string) =>
    act((teams) => teams.acceptRequest({ payload: { teamId, userId } })),
  declineRequest: (teamId: string, userId: string) =>
    act((teams) => teams.declineRequest({ payload: { teamId, userId } })),
  removeMember: (teamId: string, userId: string) =>
    act((teams) => teams.removeMember({ payload: { teamId, userId } })),
  leave: (teamId: string) => act((teams) => teams.leave({ payload: { teamId } })),
  remove: (teamId: string) => act((teams) => teams.remove({ payload: { teamId } })),
  grantAccess: (teamId: string, userId: string) => runApp(grantAccess(teamId, userId)),
};

export type TeamActions = typeof TEAM_ACTIONS;
