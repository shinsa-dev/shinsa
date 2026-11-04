import { Effect, Schema } from 'effect';
import { DEFAULT_TEAM_SCOPES, TeamScopesRequest } from '../../packages/core/src/index.ts';
import { parseRequestBody, readBearerMachine } from './requests.ts';
import { USER } from './schema.ts';
import {
  MACHINE_OWNERS,
  PAGE_SCOPES_PATH,
  resolvePreviewTeams,
  TEAM_SCOPES,
  TEAM_SCOPES_PATH,
} from './team.ts';

const decodeScopesBody = Schema.decodeUnknownEffect(Schema.fromJsonString(TeamScopesRequest));

const NO_TEAM = Response.json({ error: { code: 'not_found', message: 'No such team.' } }, { status: 404 });

const writeScopes = Effect.fn('Sandbox.writeTeamScopes')(function* (request: Request, teamId: string) {
  const current = TEAM_SCOPES.get(teamId);
  if (!current) return false;
  const { userId, scopes } = yield* parseRequestBody(request, decodeScopesBody);
  if (!userId) {
    TEAM_SCOPES.set(teamId, { ...current, scopes: scopes ?? DEFAULT_TEAM_SCOPES });
    return true;
  }
  const others = current.overrides.filter((entry) => entry.userId !== userId);
  const overrides = scopes ? [...others, { userId, scopes }] : others;
  TEAM_SCOPES.set(teamId, { ...current, overrides });
  return true;
});

export const respondTeamScopes = Effect.fn('Sandbox.respondTeamScopes')(function* (
  request: Request,
  url: URL
) {
  const page = PAGE_SCOPES_PATH.exec(url.pathname);
  if (page) {
    const teamId = page[1] ?? '';
    const team = resolvePreviewTeams(USER).find((entry) => entry.id === teamId);
    if (!team || team.role !== 'owner')
      return Response.json(
        { error: { code: 'not_owner', message: 'Only the team’s owner can do this.' } },
        { status: 403 }
      );
    if (!(yield* writeScopes(request, teamId))) return NO_TEAM;
    return Response.json(resolvePreviewTeams(USER).find((entry) => entry.id === teamId));
  }
  const machine = TEAM_SCOPES_PATH.exec(url.pathname);
  if (!(machine && MACHINE_OWNERS[readBearerMachine(request)])) return null;
  const teamId = machine[1] ?? '';
  if (!(yield* writeScopes(request, teamId))) return NO_TEAM;
  return Response.json(resolvePreviewTeams(USER).find((entry) => entry.id === teamId));
});
