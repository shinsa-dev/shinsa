import { dirname, join } from 'node:path';
import {
  type Bytes,
  type ConnectResponse,
  createFrameOpener,
  createTeamHello,
  decodeText,
  deriveTeamSessionKey,
  isTaskSettled,
  isTeamSnapshotExpired,
  parseShareMessage,
  parseShareWelcome,
  type RemoteTeam,
  type ShareMessage,
  selectTeamSnapshotSigner,
  serializeShareMessage,
  type TeamFeedMachine,
  type TeamFeedSnapshot,
  type TeamFeedStatus,
  type TeamFeedTask,
  type TeamListView,
  type TeamMachine,
  type TeamSnapshot,
  type TeamTask,
  type TeamView,
  type TeamViewTarget,
  verifyTeamSnapshot,
  verifyTeamWelcome,
} from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { ChannelPeer } from './channel.ts';
import { ControlError } from './control.ts';
import type { Remote } from './index.ts';
import { createChannelEphemeral } from './share-channel.ts';
import { resolveKeyDigest, TEAM_SNAPSHOTS_FILE, TeamSnapshots } from './team-snapshots.ts';

export const TEAM_FEED_OFFLINE = 'The teammate’s machine is offline.';

export const TEAM_FEED_REFUSED = 'The teammate’s machine does not let this machine see its team tasks.';

export const TEAM_VIEW_GONE = 'This task is not shown to your team any more.';

const TEAM_RETRY_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

const TEAM_REFUSED_RETRY_MS = [60_000, 120_000, 300_000];

const POLICY_VIOLATION = 1008;

const NORMAL_CLOSE = 1000;

export interface FeedSocket {
  binaryType: string;
  send: (data: string) => void;
  close: () => void;
  addEventListener: (
    type: 'open' | 'message' | 'close',
    listener: (event: { data?: unknown }) => void
  ) => void;
}

interface TeamStreamEnd {
  reason: string;
  gone: boolean;
}

export interface TeamStreamHandlers {
  onMessage: (message: ShareMessage) => void;
  onEnd: (end: TeamStreamEnd) => void;
}

export interface TeamStreamTarget {
  teamId: string;
  instanceId: string;
  key: string;
  view: TeamView;
}

type FeedRemote = Pick<Remote, 'store' | 'control' | 'appOrigin' | 'isEnabled' | 'subscribe'>;

export interface TeamFeedsOptions {
  remote: FeedRemote;
  createSocket?: (url: string, origin: string) => FeedSocket;
  wait?: (ms: number, run: () => void) => () => void;
  snapshotsPath?: string;
  now?: () => number;
}

interface Feed {
  teamId: string;
  key: string;
  keyDigest: string;
  machine: TeamMachine;
  status: TeamFeedStatus;
  reason: string | null;
  tasks: TeamTask[];
  updatedAt: number | null;
  snapshot: TeamSnapshot | null;
  attempt: number;
  stop: (() => void) | null;
  cancelWait: (() => void) | null;
}

function createFeedSocket(url: string, origin: string): FeedSocket {
  return new WebSocket(url, { headers: { Origin: origin } }) as unknown as FeedSocket;
}

function waitFor(ms: number, run: () => void) {
  const timer = setTimeout(run, ms);
  return () => clearTimeout(timer);
}

function toBytes(data: unknown): Bytes | null {
  return data instanceof ArrayBuffer ? new Uint8Array(data) : null;
}

function resolveFeedKey(teamId: string, instanceId: string) {
  return `${teamId} ${instanceId}`;
}

export class TeamFeeds {
  readonly #remote: FeedRemote;
  readonly #createSocket: (url: string, origin: string) => FeedSocket;
  readonly #wait: (ms: number, run: () => void) => () => void;
  readonly #feeds = new Map<string, Feed>();
  readonly #relays = new Set<() => void>();
  readonly #listeners = new Set<() => void>();
  readonly #heldListeners = new Set<() => void>();
  readonly #snapshots: TeamSnapshots;
  readonly #now: () => number;
  #heldKey = '';
  #started = false;

  constructor(options: TeamFeedsOptions) {
    this.#remote = options.remote;
    this.#createSocket = options.createSocket ?? createFeedSocket;
    this.#wait = options.wait ?? waitFor;
    this.#now = options.now ?? Date.now;
    this.#snapshots = new TeamSnapshots(
      options.snapshotsPath ?? join(dirname(options.remote.store.path), TEAM_SNAPSHOTS_FILE)
    );
    options.remote.subscribe(() => {
      if (this.#started) this.sync();
    });
  }

  start() {
    this.#started = true;
    this.sync();
  }

  stop() {
    this.#started = false;
    for (const feed of this.#feeds.values()) this.#halt(feed);
    this.#feeds.clear();
    for (const stop of [...this.#relays]) stop();
    this.#relays.clear();
  }

  subscribe(listener: () => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  subscribeHeld(listener: () => void) {
    this.#heldListeners.add(listener);
    return () => this.#heldListeners.delete(listener);
  }

  #publish() {
    for (const listener of this.#listeners) listener();
    const heldKey = [...this.#feeds.values()]
      .filter((feed) => this.#isHeld(feed))
      .map((feed) => `${feed.teamId} ${feed.machine.id} ${feed.updatedAt}`)
      .join('\n');
    if (heldKey === this.#heldKey) return;
    this.#heldKey = heldKey;
    for (const listener of this.#heldListeners) listener();
  }

  #isWatching() {
    return this.#remote.isEnabled && Boolean(this.#remote.store.file.credentials?.instanceId);
  }

  #listWatchedMachines() {
    const { file } = this.#remote.store;
    const own = file.credentials?.instanceId ?? null;
    if (!(this.#isWatching() && own)) return [];
    return file.teams.flatMap((team: RemoteTeam) => {
      const stored = this.#remote.store.selectTeamKey(team.id);
      if (!stored) return [];
      return team.machines
        .filter((machine) => machine.id !== own)
        .map((machine) => ({ teamId: team.id, key: stored.key, machine }));
    });
  }

  sync() {
    const watched = this.#listWatchedMachines();
    const kept = new Set<string>();
    for (const { teamId, key, machine } of watched) {
      const id = resolveFeedKey(teamId, machine.id);
      kept.add(id);
      const existing = this.#feeds.get(id);
      if (existing && existing.key !== key) {
        this.#halt(existing);
        this.#feeds.delete(id);
        this.#snapshots.remove(teamId, machine.id);
      }
      const feed = this.#feeds.get(id) ?? this.#createFeed(teamId, key, machine);
      this.#feeds.set(id, feed);
      feed.machine = machine;
      this.#reconcile(feed);
    }
    for (const [id, feed] of this.#feeds) {
      if (kept.has(id)) continue;
      this.#halt(feed);
      this.#feeds.delete(id);
    }
    if (this.#isWatching()) this.#pruneSnapshots();
    this.#publish();
  }

  #pruneSnapshots() {
    for (const held of this.#snapshots.list()) {
      const feed = this.#feeds.get(resolveFeedKey(held.teamId, held.instanceId));
      if (feed?.updatedAt !== null && feed?.updatedAt !== undefined && !this.#isExpired(feed)) continue;
      this.#snapshots.remove(held.teamId, held.instanceId);
    }
  }

  #createFeed(teamId: string, key: string, machine: TeamMachine): Feed {
    const keyDigest = resolveKeyDigest(key);
    const stored = this.#snapshots.select(teamId, machine.id);
    const held =
      stored && stored.keyDigest === keyDigest && !isTeamSnapshotExpired(stored.updatedAt, this.#now())
        ? stored
        : null;
    return {
      teamId,
      key,
      keyDigest,
      machine,
      status: 'connecting',
      reason: null,
      tasks: held?.tasks ?? [],
      updatedAt: held?.updatedAt ?? null,
      snapshot: held?.snapshot ?? null,
      attempt: 0,
      stop: null,
      cancelWait: null,
    };
  }

  #reconcile(feed: Feed) {
    if (!feed.machine.online) {
      this.#halt(feed);
      this.#mark(feed, 'offline', TEAM_FEED_OFFLINE);
      return;
    }
    if (feed.stop || feed.cancelWait) return;
    this.#connect(feed);
  }

  #halt(feed: Feed) {
    feed.cancelWait?.();
    feed.cancelWait = null;
    feed.stop?.();
    feed.stop = null;
  }

  #mark(feed: Feed, status: TeamFeedStatus, reason: string | null) {
    feed.status = status;
    feed.reason = reason;
  }

  #isCurrent(feed: Feed) {
    return this.#feeds.get(resolveFeedKey(feed.teamId, feed.machine.id)) === feed;
  }

  #connect(feed: Feed) {
    if (feed.status !== 'live') this.#mark(feed, 'connecting', null);
    const view: TeamView = { kind: 'list' };
    const target = { teamId: feed.teamId, instanceId: feed.machine.id, key: feed.key, view };
    feed.stop = this.openStream(target, {
      onMessage: (message) => {
        if (message.t !== 'view' || !this.#isCurrent(feed)) return;
        const list = JSON.parse(message.data) as TeamListView;
        feed.tasks = list.tasks;
        feed.updatedAt = list.updatedAt;
        feed.snapshot = list.snapshot ?? null;
        feed.attempt = 0;
        this.#mark(feed, 'live', null);
        this.#keep(feed);
        this.#publish();
        this.#adoptHeld(feed.teamId, list.held ?? []).catch((error: unknown) => {
          log.warn('[Teams] Could not check a teammate’s kept snapshots', { error: describeError(error) });
        });
      },
      onEnd: (end) => {
        feed.stop = null;
        if (!this.#isCurrent(feed)) return;
        if (end.gone) this.#forget(feed);
        this.#mark(feed, end.gone ? 'refused' : 'offline', end.reason);
        this.#publish();
        const steps = end.gone ? TEAM_REFUSED_RETRY_MS : TEAM_RETRY_MS;
        const delay = steps[Math.min(feed.attempt, steps.length - 1)] as number;
        feed.attempt += 1;
        feed.cancelWait = this.#wait(delay, () => {
          feed.cancelWait = null;
          if (this.#isCurrent(feed)) this.#reconcile(feed);
        });
      },
    });
  }

  #keep(feed: Feed) {
    if (feed.updatedAt === null) return;
    this.#snapshots.write({
      teamId: feed.teamId,
      instanceId: feed.machine.id,
      keyDigest: feed.keyDigest,
      tasks: feed.tasks,
      updatedAt: feed.updatedAt,
      snapshot: feed.snapshot,
    });
  }

  #forget(feed: Feed) {
    feed.tasks = [];
    feed.updatedAt = null;
    feed.snapshot = null;
    this.#snapshots.remove(feed.teamId, feed.machine.id);
  }

  #isExpired(feed: Feed) {
    if (feed.status === 'live' || feed.updatedAt === null) return false;
    return isTeamSnapshotExpired(feed.updatedAt, this.#now());
  }

  #isHeld(feed: Feed) {
    return feed.status !== 'live' && feed.snapshot !== null && !this.#isExpired(feed);
  }

  #canAdopt(feed: Feed) {
    return this.#isCurrent(feed) && (feed.status === 'offline' || feed.status === 'connecting');
  }

  async #adoptHeld(teamId: string, held: TeamSnapshot[]) {
    let adopted = false;
    for (const snapshot of held) {
      const instanceId = selectTeamSnapshotSigner(snapshot);
      const feed = instanceId ? this.#feeds.get(resolveFeedKey(teamId, instanceId)) : undefined;
      const signingKey = feed?.machine.signingKey;
      if (!(feed && signingKey && this.#canAdopt(feed))) continue;
      const body = await verifyTeamSnapshot(signingKey, snapshot);
      if (!(body && body.teamId === teamId && body.instanceId === instanceId && this.#canAdopt(feed)))
        continue;
      if (isTeamSnapshotExpired(body.updatedAt, this.#now()) || (feed.updatedAt ?? -1) >= body.updatedAt)
        continue;
      feed.tasks = body.tasks;
      feed.updatedAt = body.updatedAt;
      feed.snapshot = snapshot;
      this.#keep(feed);
      adopted = true;
    }
    if (adopted) this.#publish();
  }

  listHeld(teamId: string) {
    return [...this.#feeds.values()].flatMap((feed) =>
      feed.teamId === teamId && feed.snapshot && this.#isHeld(feed) ? [feed.snapshot] : []
    );
  }

  snapshot(): TeamFeedSnapshot {
    const feeds = [...this.#feeds.values()];
    const machines: TeamFeedMachine[] = feeds.map((feed) => ({
      teamId: feed.teamId,
      instanceId: feed.machine.id,
      name: feed.machine.name,
      userId: feed.machine.userId,
      status: feed.status,
      reason: feed.reason,
      ...(feed.updatedAt === null || this.#isExpired(feed) ? {} : { updatedAt: feed.updatedAt }),
    }));
    const tasks: TeamFeedTask[] = feeds.flatMap((feed) =>
      this.#isExpired(feed)
        ? []
        : feed.tasks.map((task) => ({ ...task, teamId: feed.teamId, instanceId: feed.machine.id }))
    );
    return { machines, tasks };
  }

  listTasks(filter: { teamId?: string | null; open?: boolean } = {}) {
    return this.snapshot().tasks.filter(
      (task) =>
        (!filter.teamId || task.teamId === filter.teamId) && !(filter.open && isTaskSettled(task.task))
    );
  }

  openRelay(peer: ChannelPeer, target: TeamViewTarget) {
    const feed = this.#feeds.get(resolveFeedKey(target.teamId, target.instanceId));
    if (!feed) {
      peer.close(POLICY_VIOLATION, TEAM_VIEW_GONE);
      return { close: () => undefined };
    }
    let open = true;
    const stopStream = this.openStream(
      {
        teamId: target.teamId,
        instanceId: target.instanceId,
        key: feed.key,
        view: { kind: 'task', taskId: target.taskId },
      },
      {
        onMessage: (message) => {
          if (open) peer.send(serializeShareMessage(message));
        },
        onEnd: (end) => {
          if (!open) return;
          open = false;
          this.#relays.delete(stop);
          peer.send(
            serializeShareMessage({ t: 'closed', reason: end.gone ? end.reason : TEAM_FEED_OFFLINE })
          );
          peer.close(NORMAL_CLOSE, end.reason);
        },
      }
    );
    const stop = () => {
      if (!open) return;
      open = false;
      this.#relays.delete(stop);
      stopStream();
    };
    this.#relays.add(stop);
    return { close: stop };
  }

  openStream(target: TeamStreamTarget, handlers: TeamStreamHandlers) {
    let socket: FeedSocket | null = null;
    let ended = false;
    const end = (result: TeamStreamEnd) => {
      if (ended) return;
      ended = true;
      socket?.close();
      socket = null;
      handlers.onEnd(result);
    };
    const begin = async () => {
      const url = await this.#requestChannelUrl(target);
      if (ended) return;
      if (!url) {
        end({ reason: TEAM_FEED_REFUSED, gone: true });
        return;
      }
      const ephemeral = await createChannelEphemeral();
      const hello = await createTeamHello(target.teamId, target.key, target.view, ephemeral.publicKey);
      if (ended) return;
      const opened = this.#createSocket(url, this.#remote.appOrigin);
      socket = opened;
      opened.binaryType = 'arraybuffer';
      let openFrame: ((frame: Bytes) => Promise<Bytes>) | null = null;
      let queue: Promise<void> = Promise.resolve();
      const readWelcome = async (text: string) => {
        const welcome = parseShareWelcome(text);
        if (welcome?.type === 'refused') return end({ reason: welcome.reason, gone: true });
        if (welcome?.type !== 'welcome' || openFrame) return end({ reason: TEAM_FEED_OFFLINE, gone: false });
        const keys = {
          team: target.teamId,
          view: target.view,
          clientEphemeral: hello.ephemeral,
          serverEphemeral: welcome.ephemeral,
        };
        if (!(await verifyTeamWelcome(target.key, keys, welcome.proof)))
          return end({ reason: TEAM_FEED_REFUSED, gone: true });
        const session = await deriveTeamSessionKey(target.key, keys, ephemeral.privateKey, welcome.ephemeral);
        openFrame = createFrameOpener(session);
      };
      const readFrame = async (data: unknown) => {
        const frame = toBytes(data);
        if (!(frame && openFrame)) return end({ reason: TEAM_FEED_OFFLINE, gone: false });
        const message = parseShareMessage(decodeText(await openFrame(frame)));
        if (!message) return end({ reason: TEAM_FEED_OFFLINE, gone: false });
        if (message.t === 'closed') return end({ reason: message.reason, gone: true });
        handlers.onMessage(message);
      };
      opened.addEventListener('open', () => opened.send(JSON.stringify(hello)));
      opened.addEventListener('close', () => {
        queue = queue.then(() => {
          if (socket === opened) end({ reason: TEAM_FEED_OFFLINE, gone: false });
        });
      });
      opened.addEventListener('message', (event) => {
        queue = queue.then(async () => {
          if (socket !== opened) return;
          try {
            if (typeof event.data === 'string') await readWelcome(event.data);
            else await readFrame(event.data);
          } catch (error) {
            log.warn('[Teams] Could not read a teammate’s machine', { error: describeError(error) });
            end({ reason: TEAM_FEED_OFFLINE, gone: false });
          }
        });
      });
    };
    begin().catch((error: unknown) => {
      if (error instanceof ControlError && (error.status === 403 || error.status === 404)) {
        end({ reason: TEAM_FEED_REFUSED, gone: true });
        return;
      }
      log.warn('[Teams] Could not reach a teammate’s machine', {
        teamId: target.teamId,
        instanceId: target.instanceId,
        error: describeError(error),
      });
      end({ reason: TEAM_FEED_OFFLINE, gone: false });
    });
    return () => {
      ended = true;
      socket?.close();
      socket = null;
    };
  }

  async #requestChannelUrl(target: TeamStreamTarget) {
    const credentials = this.#remote.store.file.credentials;
    if (!credentials) return null;
    const answer = await this.#remote.control.requestTeamAction<ConnectResponse>(
      credentials.machineToken,
      target.teamId,
      'connect',
      { instanceId: target.instanceId }
    );
    return answer.url;
  }
}
