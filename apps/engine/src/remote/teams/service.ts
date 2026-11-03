import {
  createTeamWelcome,
  DomainError,
  deriveTeamSessionKey,
  isTeamTask,
  listTeamProjectIds,
  listTeamTasks,
  parseTeamHello,
  parseTeamJoinUrl,
  type RemoteMember,
  type RemoteTeam,
  type RemoteUserId,
  resolveTeamJoinUrl,
  serializeBase64Url,
  serializePublicKey,
  signTeamSnapshot,
  TEAM_KEY_BYTES,
  type TeamId,
  type TeamListView,
  type TeamTask,
  verifyTeamHello,
} from '@shinsa/core';
import { Effect, Ref } from 'effect';
import type { ChannelPeer } from '../channel.ts';
import { EgressGate } from '../egress/service.ts';
import { createEphemeralKeys } from '../share-channel/ephemeral.ts';
import type { HelloAnswer, LiveShare } from '../share-channel/schema.ts';
import { makeShareChannel } from '../share-channel/service.ts';
import { resolveOwnerProfile } from '../store/derive.ts';
import {
  TEAM_DOMAIN_ERRORS,
  TEAM_REFUSALS,
  TEAM_REMOTE_CHANGED,
  type TeamChannel,
  type TeamJoin,
  type TeamsDefinition,
  type TeamSubject,
} from './schema.ts';

export const makeTeams = Effect.fn('Teams.make')(function* (definition: TeamsDefinition) {
  const { store, teams: calls } = definition;
  const channels = yield* Ref.make<ReadonlyMap<TeamChannel, Effect.Effect<void>>>(new Map());

  const refuse = (error: { readonly code: string; readonly message: string }) => () =>
    Effect.fail(new DomainError(error));

  const ownerRefusals = {
    NotOwner: refuse(TEAM_DOMAIN_ERRORS.notOwner),
    NotFound: refuse(TEAM_DOMAIN_ERRORS.gone),
  };

  const isViewer = (team: RemoteTeam, userId: string) =>
    team.owner.id === userId || team.members.some((member) => member.user.id === userId);

  const withoutUser = (members: readonly RemoteMember[], userId: string) =>
    members.filter((member) => member.user.id !== userId);

  const findMachineToken = Effect.fn('Teams.findMachineToken')(function* () {
    const { credentials } = yield* store.file;
    if (!credentials) return yield* new DomainError(TEAM_DOMAIN_ERRORS.notPaired);
    return definition.token(credentials.machineToken);
  });

  const findTeam = Effect.fn('Teams.findTeam')(function* (teamId: string) {
    const team = yield* store.selectTeam(teamId);
    if (!team) return yield* new DomainError(TEAM_DOMAIN_ERRORS.gone);
    return team;
  });

  const findOwnTeam = Effect.fn('Teams.findOwnTeam')(function* (teamId: string) {
    const team = yield* findTeam(teamId);
    if (team.role !== 'owner') return yield* new DomainError(TEAM_DOMAIN_ERRORS.notOwner);
    return team;
  });

  const replaceTeam = Effect.fn('Teams.replaceTeam')(function* (team: RemoteTeam) {
    const { teams } = yield* store.file;
    yield* store.recordTeams([...teams.filter((entry) => entry.id !== team.id), team]);
    yield* definition.publish;
  });

  const writeInvite = Effect.fn('Teams.writeInvite')(function* (teamId: string, invite: string | null) {
    const stored = yield* store.selectTeamKey(teamId);
    if (stored) yield* store.upsertTeamKey({ ...stored, invite });
    yield* definition.publish;
  });

  const create = Effect.fn('Teams.create')(function* (name: string) {
    const trimmed = name.trim();
    if (!trimmed) return yield* new DomainError(TEAM_DOMAIN_ERRORS.nameInvalid);
    const token = yield* findMachineToken();
    const answer = yield* calls
      .create(token, trimmed)
      .pipe(Effect.catchTag('TeamsFull', refuse(TEAM_DOMAIN_ERRORS.teamsFull)));
    yield* store.upsertTeamKey({
      teamId: answer.team.id,
      name: answer.team.name,
      key: serializeBase64Url(yield* definition.random(TEAM_KEY_BYTES)),
      invite: answer.invite,
      addedAt: yield* definition.now,
    });
    yield* replaceTeam(answer.team);
    return answer.team.id;
  });

  const join = Effect.fn('Teams.join')(function* (url: string) {
    const fragment = parseTeamJoinUrl(url);
    if (!fragment) return yield* new DomainError(TEAM_DOMAIN_ERRORS.linkInvalid);
    const token = yield* findMachineToken();
    const answer = yield* calls.join(token, fragment.invite).pipe(
      Effect.catchTags({
        NotFound: refuse(TEAM_DOMAIN_ERRORS.linkOff),
        InviteInvalid: refuse(TEAM_DOMAIN_ERRORS.linkOff),
      })
    );
    if (answer.teamId !== fragment.teamId) return yield* new DomainError(TEAM_DOMAIN_ERRORS.linkMismatch);
    const earlier = yield* store.selectTeamKey(answer.teamId);
    const file = yield* store.file;
    const owns = answer.owner.id === file.access?.owner.id;
    yield* store.upsertTeamKey({
      teamId: answer.teamId,
      name: answer.name,
      key: fragment.key,
      invite: owns ? fragment.invite : (earlier?.invite ?? null),
      addedAt: earlier?.addedAt ?? (yield* definition.now),
    });
    yield* definition.publish;
    if (answer.status === 'member') yield* definition.requestHeartbeat;
    const joined: TeamJoin = { status: answer.status, teamId: answer.teamId };
    return joined;
  });

  const renewInvite = Effect.fn('Teams.renewInvite')(function* (teamId: string) {
    yield* findOwnTeam(teamId);
    const token = yield* findMachineToken();
    const { invite } = yield* calls.invite(token, teamId as TeamId).pipe(Effect.catchTags(ownerRefusals));
    yield* writeInvite(teamId, invite);
    return invite;
  });

  const resolveJoinUrl = Effect.fn('Teams.resolveJoinUrl')(function* (teamId: string) {
    yield* findOwnTeam(teamId);
    const stored = yield* store.selectTeamKey(teamId);
    if (!stored) return yield* new DomainError(TEAM_DOMAIN_ERRORS.keyMissing);
    const invite = stored.invite ?? (yield* renewInvite(teamId));
    return resolveTeamJoinUrl({ teamId, invite, key: stored.key }, yield* definition.appOrigin);
  });

  const turnOffInvite = Effect.fn('Teams.turnOffInvite')(function* (teamId: string) {
    yield* findOwnTeam(teamId);
    const token = yield* findMachineToken();
    yield* calls.removeInvite(token, teamId as TeamId).pipe(Effect.catchTags(ownerRefusals));
    yield* writeInvite(teamId, null);
  });

  const acceptRequest = Effect.fn('Teams.acceptRequest')(function* (teamId: string, userId: string) {
    const team = yield* findOwnTeam(teamId);
    const token = yield* findMachineToken();
    const member = yield* calls.addMember(token, teamId as TeamId, userId as RemoteUserId).pipe(
      Effect.catchTags({
        NotOwner: refuse(TEAM_DOMAIN_ERRORS.notOwner),
        NotFound: refuse(TEAM_DOMAIN_ERRORS.requestNotFound),
        MembersFull: refuse(TEAM_DOMAIN_ERRORS.membersFull),
      })
    );
    yield* replaceTeam({
      ...team,
      members: [...withoutUser(team.members, userId), member],
      requests: withoutUser(team.requests, userId),
    });
  });

  const declineRequest = Effect.fn('Teams.declineRequest')(function* (teamId: string, userId: string) {
    const team = yield* findOwnTeam(teamId);
    const token = yield* findMachineToken();
    yield* calls
      .declineRequest(token, teamId as TeamId, userId as RemoteUserId)
      .pipe(Effect.catchTags(ownerRefusals));
    yield* replaceTeam({ ...team, requests: withoutUser(team.requests, userId) });
  });

  const removeMember = Effect.fn('Teams.removeMember')(function* (teamId: string, userId: string) {
    const team = yield* findOwnTeam(teamId);
    if (!team.members.some((member) => member.user.id === userId))
      return yield* new DomainError(TEAM_DOMAIN_ERRORS.memberNotFound);
    const token = yield* findMachineToken();
    yield* calls
      .removeMember(token, teamId as TeamId, userId as RemoteUserId)
      .pipe(Effect.catchTags(ownerRefusals));
    yield* replaceTeam({ ...team, members: withoutUser(team.members, userId) });
  });

  const endTeam = Effect.fn('Teams.endTeam')(function* (teamId: string, action: 'leave' | 'remove') {
    const token = yield* findMachineToken();
    if (action === 'leave')
      yield* calls.leave(token, teamId as TeamId).pipe(Effect.catchTag('NotFound', () => Effect.void));
    else yield* calls.remove(token, teamId as TeamId).pipe(Effect.catchTag('NotFound', () => Effect.void));
    yield* store.removeTeam(teamId);
    yield* definition.publish;
    for (const projectId of listTeamProjectIds(yield* definition.state, teamId)) {
      yield* definition.dispatch({ type: 'project.remove_from_team', projectId, teamId });
    }
  });

  const leave = Effect.fn('Teams.leave')(function* (teamId: string) {
    const team = yield* store.selectTeam(teamId);
    if (!(team || (yield* store.selectTeamKey(teamId))))
      return yield* new DomainError(TEAM_DOMAIN_ERRORS.gone);
    if (team?.role === 'owner') return yield* new DomainError(TEAM_DOMAIN_ERRORS.ownerCannotLeave);
    yield* endTeam(teamId, 'leave');
  });

  const remove = Effect.fn('Teams.remove')(function* (teamId: string) {
    yield* findOwnTeam(teamId);
    yield* endTeam(teamId, 'remove');
  });

  const resolveRefusal = Effect.fn('Teams.resolveRefusal')(function* (subject: TeamSubject) {
    const team = yield* store.selectTeam(subject.teamId);
    if (!team) return TEAM_REFUSALS.team;
    if (!(yield* store.selectTeamKey(subject.teamId))) return TEAM_REFUSALS.key;
    if (!isViewer(team, subject.userId)) return TEAM_REFUSALS.member;
    if (subject.view.kind === 'list') return null;
    const state = yield* definition.state;
    const task = state.tasks[subject.view.taskId];
    return task && isTeamTask(state, task, subject.teamId) ? null : TEAM_REFUSALS.task;
  });

  const authorize = Effect.fn('Teams.authorize')(function* (text: string, userId: string) {
    const hello = parseTeamHello(text);
    if (!hello) return null;
    const subject: TeamSubject = { teamId: hello.team, view: hello.view, userId };
    const refused = yield* resolveRefusal(subject);
    if (refused) return { refused };
    const stored = yield* store.selectTeamKey(hello.team);
    if (!stored) return { refused: TEAM_REFUSALS.key };
    if (!(yield* Effect.promise(() => verifyTeamHello(stored.key, hello))))
      return { refused: TEAM_REFUSALS.mismatch };
    const ephemeral = yield* createEphemeralKeys;
    const keys = {
      team: hello.team,
      view: hello.view,
      clientEphemeral: hello.ephemeral,
      serverEphemeral: yield* Effect.promise(() => serializePublicKey(ephemeral.publicKey)),
    };
    const answer: HelloAnswer<TeamSubject> = {
      subject,
      session: yield* Effect.promise(() =>
        deriveTeamSessionKey(stored.key, keys, ephemeral.privateKey, hello.ephemeral)
      ),
      welcome: yield* Effect.promise(() => createTeamWelcome(stored.key, keys)),
    };
    return answer;
  });

  const signList = Effect.fn('Teams.signList')(function* (
    teamId: string,
    tasks: TeamTask[],
    updatedAt: number
  ) {
    const instanceId = (yield* store.file).credentials?.instanceId;
    if (!instanceId) return null;
    const { privateKey } = yield* store.resolveSigningKey;
    return yield* Effect.promise(() =>
      signTeamSnapshot(privateKey, { teamId, instanceId, tasks, updatedAt })
    );
  });

  const resolveLive = Effect.fn('Teams.resolveLive')(function* (subject: TeamSubject) {
    if (subject.view.kind === 'task') return yield* definition.resolveTaskLive(subject.view.taskId);
    const file = yield* store.file;
    const listed = listTeamTasks(yield* definition.state, subject.teamId, {
      owner: file.owner,
      ownerProfile: resolveOwnerProfile(file),
      machine: yield* definition.machineName,
    });
    const tasks = EgressGate.listTeamTasks(listed);
    const { publicKey } = yield* store.resolveMachineKey;
    const grant = yield* store.selectGrant(subject.userId);
    const updatedAt = yield* definition.now;
    const snapshot = yield* signList(subject.teamId, tasks, updatedAt);
    const held = yield* definition.listHeld(subject.teamId);
    const view: TeamListView = {
      tasks,
      machineKey: publicKey,
      ...(grant?.teamId === subject.teamId ? { grant: grant.secret } : {}),
      updatedAt,
      ...(snapshot ? { snapshot } : {}),
      ...(held.length > 0 ? { held } : {}),
    };
    const live: LiveShare = { view, files: [] };
    return live;
  });

  const forkPush = (channel: TeamChannel) => Effect.asVoid(Effect.forkDetach(channel.push));

  const endChannel = (channel: TeamChannel, reason: string) =>
    channel.end(reason).pipe(
      Effect.catch((failure) =>
        Effect.logWarning('[Teams] Could not close a team view').pipe(
          Effect.annotateLogs({ error: failure.message })
        )
      ),
      Effect.forkDetach,
      Effect.asVoid
    );

  const releaseChannel = Effect.fn('Teams.releaseChannel')(function* (channel: TeamChannel) {
    const release = yield* Ref.modify(channels, (open) => {
      const rest = new Map(open);
      rest.delete(channel);
      return [open.get(channel), rest];
    });
    if (release) yield* release;
  });

  const openChannel = Effect.fn('Teams.openChannel')(function* (peer: ChannelPeer, userId: string) {
    const channel = yield* makeShareChannel<TeamSubject>({
      name: 'team view',
      peer,
      authorize: (hello) => authorize(hello, userId),
      resolveLive,
    });
    const onEnd = Effect.gen(function* () {
      const held = yield* Ref.modify(channels, (open) => {
        const rest = new Map(open);
        return [rest.delete(channel), rest];
      });
      if (held) yield* endChannel(channel, TEAM_REMOTE_CHANGED);
    });
    const release = yield* definition.acquireAccess(onEnd);
    yield* Ref.update(channels, (open) => new Map(open).set(channel, release));
    return channel;
  });

  const closeChannel = Effect.fn('Teams.closeChannel')(function* (channel: TeamChannel) {
    yield* channel.close;
    yield* releaseChannel(channel);
  });

  const listOpen = Effect.map(Ref.get(channels), (open) => [...open.keys()]);

  const syncChannels = Effect.gen(function* () {
    for (const channel of yield* listOpen) {
      const subject = yield* channel.subject;
      if (!subject) continue;
      const refused = yield* resolveRefusal(subject);
      if (!refused) {
        yield* forkPush(channel);
        continue;
      }
      yield* releaseChannel(channel);
      yield* endChannel(channel, refused);
    }
  });

  const pushTranscript = Effect.fn('Teams.pushTranscript')(function* (runId: string) {
    const taskId = (yield* definition.state).runs[runId]?.taskId;
    for (const channel of yield* listOpen) {
      const view = (yield* channel.subject)?.view;
      if (view?.kind === 'task' && view.taskId === taskId) yield* forkPush(channel);
    }
  });

  const pushLists = Effect.gen(function* () {
    for (const channel of yield* listOpen) {
      if ((yield* channel.subject)?.view.kind === 'list') yield* forkPush(channel);
    }
  });

  return {
    create,
    join,
    resolveJoinUrl,
    renewInvite,
    turnOffInvite,
    acceptRequest,
    declineRequest,
    removeMember,
    leave,
    remove,
    acceptsViewer: definition.isEnabled,
    openChannel,
    closeChannel,
    syncChannels,
    pushTranscript,
    pushLists,
  };
});
