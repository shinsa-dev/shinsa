import { randomBytes } from 'node:crypto';
import {
  createTeamWelcome,
  DomainError,
  deriveTeamSessionKey,
  isTeamPerson,
  isTeamTask,
  listTeamProjectIds,
  listTeamTasks,
  parseTeamHello,
  parseTeamJoinUrl,
  type RemoteMember,
  type RemoteTeam,
  type RemoteUserId,
  type Task,
  type AccessScopes,
  resolveTeamJoinUrl,
  serializeBase64Url,
  serializePublicKey,
  signTeamSnapshot,
  TEAM_KEY_BYTES,
  TEAM_SHARE_PRESET,
  type TeamJoinStatus,
  type TeamListView,
  type TeamTask,
  type TeamView,
  verifyTeamHello,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Engine } from '../runtime/engine.ts';
import type { ChannelPeer } from './channel.ts';
import { type RemoteControl, selectRemoteFailureTag } from './client/index.ts';
import { EgressGate } from './egress/service.ts';
import type { Remote } from './index.ts';
import type { Presence } from './presence.ts';
import { createChannelEphemeral, type HelloAnswer, type LiveShare, ShareChannel } from './share-channel.ts';
import type { Shares, ShareTranscripts } from './shares.ts';
import { resolveOwnerProfile } from './store.ts';
import type { TeamFeeds } from './team-feeds.ts';

export const TEAM_REFUSALS = {
  team: 'That machine has left this team.',
  key: 'That machine has no key for this team. Its owner can rejoin from the team’s join link.',
  member:
    'That machine does not list you in this team yet. It catches up the next time it reaches Shinsa Cloud.',
  mismatch: 'Your key for this team does not match that machine’s. Open the team’s join link again.',
  task: 'This task is no longer shown to the team.',
} as const;

export const TEAM_REMOTE_CHANGED = 'Remote access on the machine that shows these tasks was turned off.';

export interface TeamSubject {
  teamId: string;
  view: TeamView;
  userId: string;
  present?: boolean;
}

interface TeamLinks {
  acceptsViewer: () => boolean;
  openChannel: (peer: ChannelPeer, userId: string) => ShareChannel<TeamSubject>;
  closeChannel: (channel: ShareChannel<TeamSubject>) => void;
}

export interface TeamsOptions {
  engine: Pick<Engine, 'state' | 'subscribe' | 'dispatch'>;
  remote: Remote;
  shares: Pick<Shares, 'resolveLive'>;
  transcripts: Pick<ShareTranscripts, 'subscribe'>;
  held?: Pick<TeamFeeds, 'listHeld' | 'subscribeHeld'>;
  presence?: Pick<Presence, 'listTeam' | 'openViewer' | 'closeViewer' | 'subscribe'>;
  now?: () => number;
  random?: (bytes: number) => Uint8Array<ArrayBuffer>;
}

type Refusals = Partial<Record<string, DomainError>>;

const TEAM_LINK_OFF = new DomainError({
  code: 'team_link_off',
  message: 'This team link was turned off. Ask the team’s owner for a new one.',
});

const OWNER_ONLY = new DomainError({ code: 'not_owner', message: 'Only the team’s owner can do this.' });

const TEAM_GONE = new DomainError({ code: 'team_not_found', message: 'This machine is not in that team.' });

const MEMBER_NOT_FOUND = new DomainError({
  code: 'member_not_found',
  message: 'No one with that account is in this team.',
});

function createRandom(bytes: number) {
  return new Uint8Array(randomBytes(bytes));
}

function withoutUser(members: readonly RemoteMember[], userId: string) {
  return members.filter((member) => member.user.id !== userId);
}

export class Teams implements TeamLinks {
  readonly #engine: TeamsOptions['engine'];
  readonly #remote: Remote;
  readonly #shares: TeamsOptions['shares'];
  readonly #held: TeamsOptions['held'];
  readonly #presence: TeamsOptions['presence'];
  readonly #now: () => number;
  readonly #random: (bytes: number) => Uint8Array<ArrayBuffer>;
  readonly #channels = new Map<ShareChannel<TeamSubject>, () => void>();
  readonly #viewers = new Map<ShareChannel<TeamSubject>, string>();
  readonly #releasing = new Set<string>();

  constructor(options: TeamsOptions) {
    this.#engine = options.engine;
    this.#remote = options.remote;
    this.#shares = options.shares;
    this.#held = options.held;
    this.#presence = options.presence;
    this.#now = options.now ?? Date.now;
    this.#random = options.random ?? createRandom;
    options.remote.subscribe(() => this.#syncChannels());
    options.engine.subscribe(() => this.#syncChannels());
    options.transcripts.subscribe((runId) => this.#pushTranscript(runId));
    options.held?.subscribeHeld(() => this.#pushLists());
    options.presence?.subscribe(() => this.#pushLists());
  }

  #pushLists() {
    for (const channel of this.#channels.keys()) {
      if (channel.subject?.view.kind === 'list') void channel.push();
    }
  }

  #pushTranscript(runId: string) {
    const taskId = this.#engine.state.runs[runId]?.taskId;
    for (const channel of this.#channels.keys()) {
      const view = channel.subject?.view;
      if (view?.kind === 'task' && view.taskId === taskId) void channel.push();
    }
  }

  get #store() {
    return this.#remote.store;
  }

  #findMachineToken() {
    const credentials = this.#store.file.credentials;
    if (!credentials)
      throw new DomainError({
        code: 'remote_not_paired',
        message: 'Turn on remote access in Settings → General first. Teams reach your teammates through it.',
      });
    return credentials.machineToken;
  }

  #findTeam(teamId: string) {
    const team = this.#store.selectTeam(teamId);
    if (!team) throw TEAM_GONE;
    return team;
  }

  #findOwnTeam(teamId: string) {
    const team = this.#findTeam(teamId);
    if (team.role !== 'owner') throw OWNER_ONLY;
    return team;
  }

  async #call<T>(request: Promise<T>, refusals: Refusals = {}) {
    try {
      return await request;
    } catch (error) {
      const tag = selectRemoteFailureTag(error);
      const refusal = tag === null ? undefined : refusals[tag];
      throw refusal ?? error;
    }
  }

  #action<T>(request: (control: RemoteControl, token: string) => Promise<T>, refusals: Refusals = {}) {
    const token = this.#findMachineToken();
    return this.#call(request(this.#remote.control, token), {
      NotOwner: OWNER_ONLY,
      NotFound: TEAM_GONE,
      ...refusals,
    });
  }

  #replaceTeam(team: RemoteTeam) {
    const teams = this.#store.file.teams;
    const others = teams.filter((entry) => entry.id !== team.id);
    this.#store.recordTeams([...others, team]);
    this.#remote.publish();
  }

  async create(name: string) {
    const trimmed = name.trim();
    if (!trimmed) throw new DomainError({ code: 'name_invalid', message: 'Give the team a name.' });
    const token = this.#findMachineToken();
    const answer = await this.#call(this.#remote.control.requestTeamCreation(token, trimmed), {
      TeamsFull: new DomainError({
        code: 'teams_full',
        message: 'You own as many teams as you can. Remove one first.',
      }),
    });
    this.#store.upsertTeamKey({
      teamId: answer.team.id,
      name: answer.team.name,
      key: serializeBase64Url(this.#random(TEAM_KEY_BYTES)),
      invite: answer.invite,
      addedAt: this.#now(),
    });
    this.#replaceTeam(answer.team);
    return answer.team.id;
  }

  async join(url: string): Promise<{ status: TeamJoinStatus; teamId: string }> {
    const fragment = parseTeamJoinUrl(url);
    if (!fragment)
      throw new DomainError({
        code: 'team_link_invalid',
        message: 'That is not a team link. Copy the whole link, with everything after the #.',
      });
    const token = this.#findMachineToken();
    const answer = await this.#call(this.#remote.control.requestTeamJoin(token, fragment.invite), {
      NotFound: TEAM_LINK_OFF,
      InviteInvalid: TEAM_LINK_OFF,
    });
    if (answer.teamId !== fragment.teamId)
      throw new DomainError({
        code: 'team_link_invalid',
        message: 'That team link does not match its team. Ask for a new one.',
      });
    const earlier = this.#store.selectTeamKey(answer.teamId);
    const owns = answer.owner.id === this.#store.file.access?.owner.id;
    this.#store.upsertTeamKey({
      teamId: answer.teamId,
      name: answer.name,
      key: fragment.key,
      invite: owns ? fragment.invite : (earlier?.invite ?? null),
      addedAt: earlier?.addedAt ?? this.#now(),
    });
    this.#remote.publish();
    if (answer.status === 'member') await this.#remote.requestHeartbeat();
    return { status: answer.status, teamId: answer.teamId };
  }

  listKeys() {
    const teams = new Set(this.#store.file.teams.map((team) => team.id));
    return this.#store.file.teamKeys
      .filter((stored) => teams.has(stored.teamId))
      .map(({ teamId, name, key }) => ({ teamId, name, key }));
  }

  async resolveJoinUrl(teamId: string) {
    this.#findOwnTeam(teamId);
    const stored = this.#store.selectTeamKey(teamId);
    if (!stored)
      throw new DomainError({
        code: 'team_key_missing',
        message: 'This machine does not hold the team’s key. Open the team link on this machine first.',
      });
    const invite = stored.invite ?? (await this.renewInvite(teamId));
    return resolveTeamJoinUrl({ teamId, invite, key: stored.key }, this.#remote.appOrigin);
  }

  async renewInvite(teamId: string) {
    this.#findOwnTeam(teamId);
    const { invite } = await this.#action((control, token) => control.requestTeamInvite(token, teamId));
    this.#writeInvite(teamId, invite);
    return invite;
  }

  async turnOffInvite(teamId: string) {
    this.#findOwnTeam(teamId);
    await this.#action((control, token) => control.requestTeamInviteRemoval(token, teamId));
    this.#writeInvite(teamId, null);
  }

  #writeInvite(teamId: string, invite: string | null) {
    const stored = this.#store.selectTeamKey(teamId);
    if (stored) this.#store.upsertTeamKey({ ...stored, invite });
    this.#remote.publish();
  }

  async acceptRequest(teamId: string, userId: string) {
    const team = this.#findOwnTeam(teamId);
    const member = await this.#action(
      (control, token) => control.requestTeamMemberAddition(token, teamId, userId),
      {
        NotFound: new DomainError({
          code: 'request_not_found',
          message: 'No one with that account asked to join this team.',
        }),
        MembersFull: new DomainError({
          code: 'members_full',
          message: 'This team has as many members as it can. Remove one first.',
        }),
      }
    );
    this.#replaceTeam({
      ...team,
      members: [...withoutUser(team.members, userId), member],
      requests: withoutUser(team.requests, userId),
    });
  }

  async declineRequest(teamId: string, userId: string) {
    const team = this.#findOwnTeam(teamId);
    await this.#action((control, token) => control.requestTeamDecline(token, teamId, userId));
    this.#replaceTeam({ ...team, requests: withoutUser(team.requests, userId) });
  }

  async removeMember(teamId: string, userId: string) {
    const team = this.#findOwnTeam(teamId);
    if (!team.members.some((member) => member.user.id === userId)) throw MEMBER_NOT_FOUND;
    await this.#action((control, token) => control.requestTeamMemberRemoval(token, teamId, userId));
    this.#replaceTeam({ ...team, members: withoutUser(team.members, userId) });
  }

  async updateScopes(teamId: string, userId: string | null, scopes: AccessScopes | null) {
    const team = this.#findOwnTeam(teamId);
    if (userId !== null && !team.members.some((member) => member.user.id === userId)) throw MEMBER_NOT_FOUND;
    const request = userId === null ? { scopes } : { userId: userId as RemoteUserId, scopes };
    const answer = await this.#action((control, token) => control.requestTeamScopes(token, teamId, request), {
      NotFound: userId === null ? TEAM_GONE : MEMBER_NOT_FOUND,
    });
    this.#replaceTeam(answer);
  }

  async leave(teamId: string) {
    const team = this.#store.selectTeam(teamId);
    if (!(team || this.#store.selectTeamKey(teamId))) throw TEAM_GONE;
    if (team?.role === 'owner')
      throw new DomainError({ code: 'owner_cannot_leave', message: 'You own this team. Remove it instead.' });
    await this.#endTeam(teamId, 'leave');
  }

  async remove(teamId: string) {
    this.#findOwnTeam(teamId);
    await this.#endTeam(teamId, 'remove');
  }

  async #endTeam(teamId: string, action: 'leave' | 'remove') {
    try {
      const token = this.#findMachineToken();
      if (action === 'leave') await this.#remote.control.requestTeamLeave(token, teamId);
      else await this.#remote.control.requestTeamRemoval(token, teamId);
    } catch (error) {
      if (selectRemoteFailureTag(error) !== 'NotFound') throw error;
    }
    this.#store.removeTeam(teamId);
    this.#remote.publish();
    for (const projectId of listTeamProjectIds(this.#engine.state, teamId)) {
      await this.#engine.dispatch({ type: 'project.remove_from_team', projectId, teamId });
    }
  }

  acceptsViewer() {
    return this.#remote.isEnabled;
  }

  openChannel(peer: ChannelPeer, userId: string) {
    const channel = new ShareChannel<TeamSubject>(peer, {
      name: 'team view',
      authorize: async (hello) => {
        const answer = await this.#authorize(hello, userId);
        if (answer && 'subject' in answer && answer.subject.present) this.#openViewer(channel, userId);
        return answer;
      },
      resolveLive: (subject) => this.#resolveLive(subject),
    });
    const release = this.#remote.access.acquire(() => {
      if (!this.#channels.delete(channel)) return;
      this.#closeViewer(channel);
      this.#endChannel(channel, TEAM_REMOTE_CHANGED);
    });
    this.#channels.set(channel, release);
    return channel;
  }

  closeChannel(channel: ShareChannel<TeamSubject>) {
    channel.close();
    this.#releaseChannel(channel);
  }

  #releaseChannel(channel: ShareChannel<TeamSubject>) {
    const release = this.#channels.get(channel);
    this.#channels.delete(channel);
    this.#closeViewer(channel);
    release?.();
  }

  #openViewer(channel: ShareChannel<TeamSubject>, userId: string) {
    if (this.#viewers.has(channel)) return;
    this.#viewers.set(channel, userId);
    this.#presence?.openViewer(userId);
  }

  #closeViewer(channel: ShareChannel<TeamSubject>) {
    const userId = this.#viewers.get(channel);
    if (userId === undefined) return;
    this.#viewers.delete(channel);
    this.#presence?.closeViewer(userId);
  }

  #endChannel(channel: ShareChannel<TeamSubject>, reason: string) {
    channel.end(reason).catch((error: unknown) => {
      log.warn('[Teams] Could not close a team view', { error: describeError(error) });
    });
  }

  #resolveRefusal(subject: TeamSubject) {
    const team = this.#store.selectTeam(subject.teamId);
    if (!team) return TEAM_REFUSALS.team;
    if (!this.#store.selectTeamKey(subject.teamId)) return TEAM_REFUSALS.key;
    if (!isTeamPerson(team, subject.userId)) return TEAM_REFUSALS.member;
    if (subject.view.kind === 'list') return null;
    const task = this.#engine.state.tasks[subject.view.taskId];
    return task && isTeamTask(this.#engine.state, task, subject.teamId) ? null : TEAM_REFUSALS.task;
  }

  async #authorize(text: string, userId: string): Promise<HelloAnswer<TeamSubject>> {
    const hello = parseTeamHello(text);
    if (!hello) return null;
    const subject = { teamId: hello.team, view: hello.view, userId, present: hello.watcher !== 'machine' };
    const refused = this.#resolveRefusal(subject);
    if (refused) return { refused };
    const stored = this.#store.selectTeamKey(hello.team);
    if (!stored) return { refused: TEAM_REFUSALS.key };
    if (!(await verifyTeamHello(stored.key, hello))) return { refused: TEAM_REFUSALS.mismatch };
    const ephemeral = await createChannelEphemeral();
    const keys = {
      team: hello.team,
      view: hello.view,
      clientEphemeral: hello.ephemeral,
      serverEphemeral: await serializePublicKey(ephemeral.publicKey),
    };
    return {
      subject,
      session: await deriveTeamSessionKey(stored.key, keys, ephemeral.privateKey, hello.ephemeral),
      welcome: await createTeamWelcome(stored.key, keys),
    };
  }

  async #resolveLive(subject: TeamSubject): Promise<LiveShare> {
    if (subject.view.kind === 'task') return this.#shares.resolveLive(subject.view.taskId, TEAM_SHARE_PRESET);
    const listed = listTeamTasks(this.#engine.state, subject.teamId, {
      owner: this.#store.file.owner,
      ownerProfile: resolveOwnerProfile(this.#store.file),
      machine: this.#remote.snapshot().machineName,
    });
    const tasks = EgressGate.listTeamTasks(listed);
    const { publicKey } = await this.#store.resolveMachineKey();
    const grant = this.#remote.resolveTeamGrant(subject.userId, subject.teamId);
    const updatedAt = this.#now();
    const snapshot = await this.#signList(subject.teamId, tasks, updatedAt);
    const held = this.#held?.listHeld(subject.teamId) ?? [];
    const team = this.#store.selectTeam(subject.teamId);
    const presence = team
      ? (this.#presence?.listTeam(team, this.#store.file.access?.owner.id ?? null) ?? [])
      : [];
    const view: TeamListView = {
      tasks,
      machineKey: publicKey,
      ...(grant ? { grant } : {}),
      updatedAt,
      ...(snapshot ? { snapshot } : {}),
      ...(held.length > 0 ? { held } : {}),
      ...(presence.length > 0 ? { presence } : {}),
    };
    return { view, files: [] };
  }

  async #signList(teamId: string, tasks: TeamTask[], updatedAt: number) {
    const instanceId = this.#store.file.credentials?.instanceId;
    if (!instanceId) return null;
    const { privateKey } = await this.#store.resolveSigningKey();
    return signTeamSnapshot(privateKey, { teamId, instanceId, tasks, updatedAt });
  }

  #isHoldKept(task: Task) {
    const holder = task.handoff?.teamId ? task.handoff.guest : null;
    if (!(holder && task.handoff?.teamId)) return true;
    const { teamId } = task.handoff;
    return (
      this.#remote.resolveTeamScope(holder.id, teamId) !== null &&
      isTeamTask(this.#engine.state, task, teamId)
    );
  }

  #releaseHolds() {
    for (const task of Object.values(this.#engine.state.tasks)) {
      if (this.#isHoldKept(task) || this.#releasing.has(task.id)) continue;
      this.#releasing.add(task.id);
      this.#engine
        .dispatch({ type: 'handoff.remove', taskId: task.id })
        .catch((error: unknown) => {
          log.warn('[Teams] Could not end a teammate’s hold on a task', {
            taskId: task.id,
            error: describeError(error),
          });
        })
        .finally(() => this.#releasing.delete(task.id));
    }
  }

  #syncChannels() {
    this.#releaseHolds();
    for (const channel of [...this.#channels.keys()]) {
      const subject = channel.subject;
      if (!subject) continue;
      const refused = this.#resolveRefusal(subject);
      if (!refused) {
        void channel.push();
        continue;
      }
      this.#releaseChannel(channel);
      this.#endChannel(channel, refused);
    }
  }
}
