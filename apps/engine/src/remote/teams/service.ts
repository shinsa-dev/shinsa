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
  type ShinsaCommand,
  signTeamSnapshot,
  TEAM_KEY_BYTES,
  TEAM_SHARE_PRESET,
  type TeamId,
  type TeamListView,
  type TeamTask,
  verifyTeamHello,
} from '@shinsa/core';
import { Clock, Context, Effect, Layer, Redacted, Ref } from 'effect';
import { Transcripts } from '../../agents/transcripts/service.ts';
import { describeError } from '../../log/redact.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { AccessScope } from '../access/service.ts';
import type { ChannelPeer } from '../channel/schema.ts';
import { RemoteOrigin } from '../client/schema.ts';
import { RemoteClient } from '../client/service.ts';
import { EgressGate } from '../egress/service.ts';
import { Remote } from '../machine/service.ts';
import { RandomBytes } from '../schema.ts';
import { createEphemeralKeys } from '../share-channel/ephemeral.ts';
import { type HelloAnswer, type LiveShare, ShareChannelBroke } from '../share-channel/schema.ts';
import { makeShareChannel } from '../share-channel/service.ts';
import { Shares } from '../shares/service.ts';
import { resolveOwnerProfile } from '../store/derive.ts';
import type { StoredTeamKey } from '../store/schema.ts';
import { RemoteStore } from '../store/service.ts';
import { TeamFeeds } from '../team-feeds/service.ts';
import {
  TEAM_DOMAIN_ERRORS,
  TEAM_REFUSALS,
  TEAM_REMOTE_CHANGED,
  type TeamChannel,
  TeamCommandFailed,
  type TeamJoin,
  type TeamsHandle,
  type TeamSubject,
} from './schema.ts';

export class Teams extends Context.Service<Teams, TeamsHandle>()('shinsa/engine/remote/teams/Teams') {
  static readonly layer = Layer.effect(
    Teams,
    Effect.gen(function* () {
      const engine = yield* EngineCore;
      const remote = yield* Remote;
      const remoteStore = yield* RemoteStore;
      const access = yield* AccessScope;
      const shares = yield* Shares;
      const feeds = yield* TeamFeeds;
      const transcripts = yield* Transcripts;
      const client = yield* RemoteClient;
      const appOrigin = yield* RemoteOrigin;
      const randomBytes = yield* RandomBytes;
      const context = yield* Effect.context<never>();
      const runSync = Effect.runSyncWith(context);
      const calls = client.teams;

      const broke = (error: unknown) => new ShareChannelBroke({ message: describeError(error) });

      const store = {
        file: remoteStore.file,
        selectTeam: remoteStore.selectTeam,
        selectTeamKey: remoteStore.selectTeamKey,
        selectGrant: remoteStore.selectGrant,
        recordTeams: (teams: RemoteTeam[]) => Effect.asVoid(Effect.orDie(remoteStore.recordTeams(teams))),
        upsertTeamKey: (stored: StoredTeamKey) => Effect.orDie(remoteStore.upsertTeamKey(stored)),
        removeTeam: (teamId: string) => Effect.orDie(remoteStore.removeTeam(teamId)),
        resolveMachineKey: remoteStore.resolveMachineKey.pipe(Effect.mapError(broke)),
        resolveSigningKey: remoteStore.resolveSigningKey.pipe(Effect.mapError(broke)),
      };

      const dispatch = (command: ShinsaCommand) =>
        engine.dispatch(command).pipe(
          Effect.asVoid,
          Effect.catchTag('EngineStopped', (error) =>
            Effect.fail(new TeamCommandFailed({ message: error.message }))
          )
        );
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
        return Redacted.make(credentials.machineToken);
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
        yield* remote.publish;
      });

      const writeInvite = Effect.fn('Teams.writeInvite')(function* (teamId: string, invite: string | null) {
        const stored = yield* store.selectTeamKey(teamId);
        if (stored) yield* store.upsertTeamKey({ ...stored, invite });
        yield* remote.publish;
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
          key: serializeBase64Url(randomBytes(TEAM_KEY_BYTES)),
          invite: answer.invite,
          addedAt: yield* Clock.currentTimeMillis,
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
          addedAt: earlier?.addedAt ?? (yield* Clock.currentTimeMillis),
        });
        yield* remote.publish;
        if (answer.status === 'member') yield* remote.requestHeartbeat;
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
        return resolveTeamJoinUrl({ teamId, invite, key: stored.key }, appOrigin);
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
        else
          yield* calls.remove(token, teamId as TeamId).pipe(Effect.catchTag('NotFound', () => Effect.void));
        yield* store.removeTeam(teamId);
        yield* remote.publish;
        for (const projectId of listTeamProjectIds(yield* engine.state, teamId)) {
          yield* dispatch({ type: 'project.remove_from_team', projectId, teamId });
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
        const state = yield* engine.state;
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
        if (subject.view.kind === 'task')
          return yield* shares
            .resolveLive(subject.view.taskId, TEAM_SHARE_PRESET)
            .pipe(Effect.mapError(broke));
        const file = yield* store.file;
        const listed = listTeamTasks(yield* engine.state, subject.teamId, {
          owner: file.owner,
          ownerProfile: resolveOwnerProfile(file),
          machine: remote.machineName,
        });
        const tasks = EgressGate.listTeamTasks(listed);
        const { publicKey } = yield* store.resolveMachineKey;
        const grant = yield* store.selectGrant(subject.userId);
        const updatedAt = yield* Clock.currentTimeMillis;
        const snapshot = yield* signList(subject.teamId, tasks, updatedAt);
        const held = yield* feeds.listHeld(subject.teamId);
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
        const { release } = yield* access.acquire(onEnd);
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
        const taskId = (yield* engine.state).runs[runId]?.taskId;
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

      yield* remote.observe(syncChannels);
      yield* engine.observe(() => runSync(syncChannels));
      yield* feeds.observeHeld(pushLists);
      const releaseTranscripts = yield* transcripts.subscribe((runId) => runSync(pushTranscript(runId)));
      yield* Effect.addFinalizer(() => releaseTranscripts);

      return Teams.of({
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
        acceptsViewer: remote.isEnabled,
        openChannel,
        closeChannel,
      });
    })
  );
}
