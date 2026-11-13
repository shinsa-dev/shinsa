import {
  type AccessScopes,
  createTeamKeyRequest,
  createTeamWelcome,
  DomainError,
  deriveTeamSessionKey,
  isTeamPerson,
  isTeamTask,
  listMachineExtraScopes,
  listTeamInitiatives,
  listTeamProjectIds,
  listTeamTasks,
  openTeamKey,
  parseTeamHello,
  parseTeamKeyDelivery,
  parseTeamJoinUrl,
  type RemoteMember,
  type RemoteTeam,
  type RemoteUserId,
  resolveTeamJoinUrl,
  serializeBase64Url,
  serializePublicKey,
  type ShinsaCommand,
  signTeamSnapshot,
  type Task,
  TEAM_KEY_BYTES,
  TEAM_KEY_RECEIVED,
  TEAM_KEY_UNWANTED,
  type TeamKeyDelivery,
  TEAM_SHARE_SCOPES,
  type TeamId,
  type TeamInitiative,
  type TeamListView,
  type TeamTask,
  verifyTeamHello,
  TEAM_REFUSALS,
} from '@shinsa/core';
import { Clock, Context, Effect, Layer, Redacted, Ref, Option } from 'effect';
import { Transcripts } from '../../agents/transcripts/service.ts';
import { describeError } from '../../log/redact.ts';
import { EngineCore } from '../../runtime/engine/service.ts';
import { AccessScope } from '../access/service.ts';
import type { ChannelPeer } from '../channel/schema.ts';
import { RemoteOrigin } from '../client/schema.ts';
import { RemoteClient } from '../client/service.ts';
import { EgressGate } from '../egress/service.ts';
import { Remote } from '../machine/service.ts';
import { Presence } from '../presence/service.ts';
import { RandomBytes } from '../schema.ts';
import { createEphemeralKeys } from '../share-channel/ephemeral.ts';
import {
  type ChannelRefusal,
  type HelloAnswer,
  type LiveShare,
  ShareChannelBroke,
} from '../share-channel/schema.ts';
import { makeShareChannel } from '../share-channel/service.ts';
import { Shares } from '../shares/service.ts';
import { resolveOwnerProfile } from '../store/derive.ts';
import type { StoredTeamKey } from '../store/schema.ts';
import { RemoteStore } from '../store/service.ts';
import { TeamFeeds } from '../team-feeds/service.ts';
import {
  TEAM_DOMAIN_ERRORS,
  KEY_WAITS_LIMIT,
  type KeyWait,
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
      const presence = yield* Presence;
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
        writeExtra: (extra: { teamId: string; userId: string; scopes: AccessScopes[number][] }) =>
          Effect.orDie(remoteStore.writeExtra(extra)),
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
      const viewers = new Map<TeamChannel, string>();
      const asking = yield* Ref.make<ReadonlySet<string>>(new Set());
      const waiting = yield* Ref.make<ReadonlyArray<KeyWait>>([]);
      const releasing = new Set<string>();

      const refuse = (error: { readonly code: string; readonly message: string }) => () =>
        Effect.fail(new DomainError(error));

      const ownerRefusals = {
        NotOwner: refuse(TEAM_DOMAIN_ERRORS.notOwner),
        NotFound: refuse(TEAM_DOMAIN_ERRORS.gone),
      };

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
        const fragment = Option.getOrNull(parseTeamJoinUrl(url));
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

      const updateScopes = Effect.fn('Teams.updateScopes')(function* (
        teamId: string,
        userId: string | null,
        scopes: AccessScopes | null
      ) {
        const team = yield* findOwnTeam(teamId);
        if (userId !== null && !team.members.some((member) => member.user.id === userId))
          return yield* new DomainError(TEAM_DOMAIN_ERRORS.memberNotFound);
        const token = yield* findMachineToken();
        const request = userId === null ? { scopes } : { userId: userId as RemoteUserId, scopes };
        const answer = yield* calls.scopes(token, teamId as TeamId, request).pipe(
          Effect.catchTags({
            NotOwner: refuse(TEAM_DOMAIN_ERRORS.notOwner),
            NotFound: refuse(userId === null ? TEAM_DOMAIN_ERRORS.gone : TEAM_DOMAIN_ERRORS.memberNotFound),
          })
        );
        yield* replaceTeam(answer);
      });

      const updateExtra = Effect.fn('Teams.updateExtra')(function* (
        teamId: string,
        userId: string,
        scopes: AccessScopes
      ) {
        const team = yield* findTeam(teamId);
        if (!isTeamPerson(team, userId) || (yield* remote.isOwner(userId)))
          return yield* new DomainError(TEAM_DOMAIN_ERRORS.memberNotFound);
        yield* store.writeExtra({ teamId, userId, scopes: [...listMachineExtraScopes(scopes)] });
        yield* remote.publish;
      });

      const listKeys = Effect.gen(function* () {
        const file = yield* store.file;
        const teams = new Set(file.teams.map((team) => team.id));
        return file.teamKeys
          .filter((stored) => teams.has(stored.teamId))
          .map(({ teamId, name, key }) => ({ teamId, name, key }));
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
        if (!isTeamPerson(team, subject.userId)) return TEAM_REFUSALS.member;
        if (subject.view.kind === 'list') return null;
        const state = yield* engine.state;
        const task = state.tasks[subject.view.taskId];
        return task && isTeamTask(state, task, subject.teamId) ? null : TEAM_REFUSALS.task;
      });

      const requestKey = Effect.fn('Teams.requestKey')(function* (teamId: string) {
        const team = yield* findTeam(teamId);
        if (team.role === 'owner' || (yield* store.selectTeamKey(teamId))) return;
        yield* Ref.update(asking, (all) => new Set(all).add(teamId));
      });

      const createKeyRefusal = Effect.fn('Teams.createKeyRefusal')(function* (teamId: string) {
        const refusal: ChannelRefusal = { refused: TEAM_REFUSALS.key };
        const instanceId = (yield* store.file).credentials?.instanceId;
        if (!instanceId) return refusal;
        const { privateKey } = yield* store.resolveSigningKey;
        const ephemeral = yield* createEphemeralKeys;
        const ask = (yield* Ref.get(asking)).has(teamId);
        const keyRequest = yield* createTeamKeyRequest(
          privateKey,
          { teamId, instanceId },
          ephemeral.publicKey,
          ask
        );
        const wait: KeyWait = { teamId, recipient: keyRequest.ephemeral, privateKey: ephemeral.privateKey };
        yield* Ref.update(waiting, (all) => [...all, wait].slice(-KEY_WAITS_LIMIT));
        return { ...refusal, keyRequest };
      });

      const isKeySender = Effect.fn('Teams.isKeySender')(function* (team: RemoteTeam, userId: string) {
        if (userId === (yield* store.file).access?.owner.id) return true;
        return userId === team.owner.id && (yield* Ref.get(asking)).has(team.id);
      });

      const receiveKey = Effect.fn('Teams.receiveKey')(function* (delivery: TeamKeyDelivery, userId: string) {
        const unwanted: ChannelRefusal = { refused: TEAM_KEY_UNWANTED };
        const team = yield* store.selectTeam(delivery.team);
        const wait = (yield* Ref.get(waiting)).find(
          (entry) => entry.teamId === delivery.team && entry.recipient === delivery.recipient
        );
        if (!(team && wait) || (yield* store.selectTeamKey(team.id))) return unwanted;
        if (!(yield* isKeySender(team, userId))) return unwanted;
        const key = yield* openTeamKey(wait.privateKey, delivery);
        if (!key) return unwanted;
        yield* store.upsertTeamKey({
          teamId: team.id,
          name: team.name,
          key,
          invite: null,
          addedAt: yield* Clock.currentTimeMillis,
        });
        yield* Ref.update(waiting, (all) => all.filter((entry) => entry.teamId !== team.id));
        yield* Ref.update(asking, (all) => new Set([...all].filter((teamId) => teamId !== team.id)));
        yield* remote.publish;
        const received: ChannelRefusal = { refused: TEAM_KEY_RECEIVED };
        return received;
      });

      const authorize = Effect.fn('Teams.authorize')(function* (text: string, userId: string) {
        const delivery = Option.getOrNull(parseTeamKeyDelivery(text));
        if (delivery) return yield* receiveKey(delivery, userId);
        const hello = Option.getOrNull(parseTeamHello(text));
        if (!hello) return null;
        const subject: TeamSubject = {
          teamId: hello.team,
          view: hello.view,
          userId,
          present: hello.watcher !== 'machine',
        };
        const refused = yield* resolveRefusal(subject);
        if (refused === TEAM_REFUSALS.key) return yield* createKeyRefusal(hello.team);
        if (refused) return { refused };
        const stored = yield* store.selectTeamKey(hello.team);
        if (!stored) return yield* createKeyRefusal(hello.team);
        if (!(yield* verifyTeamHello(stored.key, hello))) return { refused: TEAM_REFUSALS.mismatch };
        const ephemeral = yield* createEphemeralKeys;
        const keys = {
          team: hello.team,
          view: hello.view,
          clientEphemeral: hello.ephemeral,
          serverEphemeral: yield* serializePublicKey(ephemeral.publicKey),
        };
        const answer: HelloAnswer<TeamSubject> = {
          subject,
          session: yield* deriveTeamSessionKey(stored.key, keys, ephemeral.privateKey, hello.ephemeral).pipe(
            Effect.orDie
          ),
          welcome: yield* createTeamWelcome(stored.key, keys).pipe(Effect.orDie),
        };
        return answer;
      });

      const signList = Effect.fn('Teams.signList')(function* (
        teamId: string,
        tasks: TeamTask[],
        initiatives: TeamInitiative[],
        updatedAt: number
      ) {
        const instanceId = (yield* store.file).credentials?.instanceId;
        if (!instanceId) return null;
        const { privateKey } = yield* store.resolveSigningKey;
        return yield* signTeamSnapshot(privateKey, {
          teamId,
          instanceId,
          tasks,
          ...(initiatives.length > 0 ? { initiatives } : {}),
          updatedAt,
        });
      });

      const resolveLive = Effect.fn('Teams.resolveLive')(function* (subject: TeamSubject) {
        if (subject.view.kind === 'task')
          return yield* shares
            .resolveLive(subject.view.taskId, TEAM_SHARE_SCOPES)
            .pipe(Effect.mapError(broke));
        const file = yield* store.file;
        const state = yield* engine.state;
        const listed = listTeamTasks(state, subject.teamId, {
          owner: file.owner,
          ownerProfile: resolveOwnerProfile(file),
          machine: remote.machineName,
        });
        const tasks = EgressGate.listTeamTasks(listed);
        const initiatives = EgressGate.listTeamInitiatives(listTeamInitiatives(state, subject.teamId));
        const { publicKey } = yield* store.resolveMachineKey;
        const grant = yield* remote.resolveTeamGrant(subject.userId, subject.teamId);
        const updatedAt = yield* Clock.currentTimeMillis;
        const snapshot = yield* signList(subject.teamId, tasks, initiatives, updatedAt);
        const held = yield* feeds.listHeld(subject.teamId);
        const team = yield* store.selectTeam(subject.teamId);
        const present = team ? yield* presence.listTeam(team, file.access?.owner.id ?? null) : [];
        const view: TeamListView = {
          tasks,
          ...(initiatives.length > 0 ? { initiatives } : {}),
          machineKey: publicKey,
          ...(grant ? { grant } : {}),
          updatedAt,
          ...(snapshot ? { snapshot } : {}),
          ...(held.length > 0 ? { held } : {}),
          ...(present.length > 0 ? { presence: present } : {}),
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

      const openViewer = Effect.fn('Teams.openViewer')(function* (channel: TeamChannel, userId: string) {
        if (viewers.has(channel)) return;
        viewers.set(channel, userId);
        yield* presence.openViewer(userId);
      });

      const closeViewer = Effect.fn('Teams.closeViewer')(function* (channel: TeamChannel) {
        const userId = viewers.get(channel);
        if (userId === undefined) return;
        viewers.delete(channel);
        yield* presence.closeViewer(userId);
      });

      const releaseChannel = Effect.fn('Teams.releaseChannel')(function* (channel: TeamChannel) {
        const release = yield* Ref.modify(channels, (open) => {
          const rest = new Map(open);
          rest.delete(channel);
          return [open.get(channel), rest];
        });
        yield* closeViewer(channel);
        if (release) yield* release;
      });

      const openChannel = Effect.fn('Teams.openChannel')(function* (peer: ChannelPeer, userId: string) {
        const channel: TeamChannel = yield* makeShareChannel<TeamSubject>({
          name: 'team view',
          peer,
          authorize: (hello) =>
            authorize(hello, userId).pipe(
              Effect.tap((answer) =>
                answer && 'subject' in answer && answer.subject.present
                  ? openViewer(channel, userId)
                  : Effect.void
              )
            ),
          resolveLive,
        });
        const onEnd = Effect.gen(function* () {
          const held = yield* Ref.modify(channels, (open) => {
            const rest = new Map(open);
            return [rest.delete(channel), rest];
          });
          if (!held) return;
          yield* closeViewer(channel);
          yield* endChannel(channel, TEAM_REMOTE_CHANGED);
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

      const isHoldKept = Effect.fn('Teams.isHoldKept')(function* (task: Task) {
        const teamId = task.handoff?.teamId;
        const holder = teamId ? task.handoff?.guest : null;
        if (!(holder && teamId)) return true;
        if (!(yield* remote.resolveTeamScope(holder.id, teamId))) return false;
        return isTeamTask(yield* engine.state, task, teamId);
      });

      const releaseHolds = Effect.gen(function* () {
        for (const task of Object.values((yield* engine.state).tasks)) {
          if (releasing.has(task.id) || (yield* isHoldKept(task))) continue;
          releasing.add(task.id);
          yield* engine.dispatch({ type: 'handoff.remove', taskId: task.id }).pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Teams] Could not end a teammate’s hold on a task').pipe(
                Effect.annotateLogs({ taskId: task.id, error: describeError(error) })
              )
            ),
            Effect.ensuring(Effect.sync(() => releasing.delete(task.id))),
            Effect.forkDetach
          );
        }
      });

      const syncChannels = Effect.gen(function* () {
        yield* releaseHolds;
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
      yield* presence.observe(pushLists);
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
        updateScopes,
        updateExtra,
        listKeys,
        leave,
        remove,
        requestKey,
        acceptsViewer: remote.isEnabled,
        openChannel,
        closeChannel,
      });
    })
  );
}
