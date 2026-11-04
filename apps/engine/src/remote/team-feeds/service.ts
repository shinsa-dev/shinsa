import { join } from 'node:path';
import {
  type Bytes,
  type FrameError,
  type InstanceId,
  createFrameOpener,
  createTeamHello,
  decodeText,
  deriveTeamSessionKey,
  isTaskSettled,
  isTeamSnapshotExpired,
  parseShareMessage,
  parseShareWelcome,
  type ShareMessage,
  selectTeamSnapshotSigner,
  serializeShareMessage,
  type TeamFeedMachine,
  type TeamFeedSnapshot,
  type TeamFeedTask,
  type TeamId,
  type TeamMachine,
  type TeamPresence,
  type TeamSnapshot,
  type TeamTask,
  type TeamViewTarget,
  verifyTeamSnapshot,
  verifyTeamWelcome,
} from '@shinsa/core';
import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  FiberMap,
  Layer,
  Option,
  Queue,
  Redacted,
  Ref,
  Schedule,
  Schema,
  Scope,
} from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { describeError } from '../../log/redact.ts';
import { AccessScope } from '../access/service.ts';
import type { ChannelPeer } from '../channel/schema.ts';
import { RemoteOrigin } from '../client/schema.ts';
import { RemoteClient } from '../client/service.ts';
import { Remote } from '../machine/service.ts';
import { NORMAL_CLOSE, POLICY_VIOLATION } from '../schema.ts';
import { createEphemeralKeys } from '../share-channel/ephemeral.ts';
import { RemoteStore } from '../store/service.ts';
import { resolveKeyDigest } from '../team-snapshots/digest.ts';
import { TEAM_SNAPSHOTS_FILE } from '../team-snapshots/schema.ts';
import { makeTeamSnapshots } from '../team-snapshots/service.ts';
import { createTeamViewRecorder, type TeamViewRecorder } from '../team-views/recorder.ts';
import { TEAM_VIEWS_DIR, TEAM_VIEWS_LIMIT } from '../team-views/schema.ts';
import { makeTeamViews } from '../team-views/service.ts';
import {
  type Feed,
  type FeedSocketEvent,
  type HeldCloses,
  ListViewText,
  TEAM_FEED_OFFLINE,
  TEAM_FEED_REFUSED,
  TEAM_REFUSED_RETRY,
  TEAM_RETRY,
  TEAM_VIEW_FETCH_TIMEOUT,
  TEAM_VIEW_GONE,
  TEAM_VIEW_REFRESH,
  TeamConnectFailed,
  TeamFeedSettings,
  type TeamFeedsHandle,
  TeamFeedUnreadable,
  type TeamRelay,
  type TeamStreamEnd,
  type TeamStreamHandlers,
  type TeamStreamTarget,
  type TeamTaskFilter,
} from './schema.ts';

export class TeamFeeds extends Context.Service<TeamFeeds, TeamFeedsHandle>()(
  'shinsa/engine/remote/team-feeds/TeamFeeds'
) {
  static readonly layer = Layer.effect(
    TeamFeeds,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const config = yield* EngineConfig;
      const remote = yield* Remote;
      const store = yield* RemoteStore;
      const access = yield* AccessScope;
      const client = yield* RemoteClient;
      const appOrigin = yield* RemoteOrigin;
      const settings = yield* TeamFeedSettings;
      const snapshots = yield* makeTeamSnapshots({ path: join(config.dataDir, TEAM_SNAPSHOTS_FILE) });
      const views = yield* makeTeamViews({
        dir: join(config.dataDir, TEAM_VIEWS_DIR),
        limit: TEAM_VIEWS_LIMIT,
      });
      const acquireAccess = (close: Effect.Effect<void>) =>
        Effect.map(access.acquire(close), (lease) => lease.release);
      const requestTeamConnect = (token: string, teamId: string, instanceId: string) =>
        client.teams.connect(Redacted.make(token), teamId as TeamId, instanceId as InstanceId).pipe(
          Effect.map((answer) => answer.url),
          Effect.mapError((error) => new TeamConnectFailed({ tag: error._tag, message: error.message }))
        );
      const feeds = yield* Ref.make<ReadonlyMap<string, Feed>>(new Map());
      const links = yield* FiberMap.make<string>();
      const refreshes = yield* FiberMap.make<string>();
      const relays = yield* Ref.make<ReadonlyMap<number, Effect.Effect<void>>>(new Map());
      const heldRelays = yield* Ref.make<ReadonlyMap<string, HeldCloses>>(new Map());
      const started = yield* Ref.make(false);
      const heldKey = yield* Ref.make('');
      const counter = yield* Ref.make(0);
      const listeners = new Set<Effect.Effect<void>>();
      const heldListeners = new Set<Effect.Effect<void>>();
      const decodeList = Schema.decodeUnknownEffect(ListViewText);
      const offline: TeamStreamEnd = { reason: TEAM_FEED_OFFLINE, gone: false };
      const refused: TeamStreamEnd = { reason: TEAM_FEED_REFUSED, gone: true };

      const resolveFeedKey = (teamId: string, instanceId: string) => `${teamId} ${instanceId}`;
      const nextId = Ref.updateAndGet(counter, (count) => count + 1);
      const unreadable = (error: unknown) => new TeamFeedUnreadable({ message: describeError(error) });
      const unreachable = (error: unknown) =>
        new TeamConnectFailed({ tag: null, message: describeError(error) });
      const isExpired = (feed: Feed, now: number) =>
        feed.status !== 'live' && feed.updatedAt !== null && isTeamSnapshotExpired(feed.updatedAt, now);
      const isHeld = (feed: Feed, now: number) =>
        feed.status !== 'live' && feed.snapshot !== null && !isExpired(feed, now);
      const canAdopt = (feed: Feed) => feed.status === 'offline' || feed.status === 'connecting';
      const dropKey =
        <K, V>(key: K) =>
        (all: ReadonlyMap<K, V>) => {
          const next = new Map(all);
          next.delete(key);
          return next;
        };

      const selectFeed = (id: string) => Effect.map(Ref.get(feeds), (all) => all.get(id) ?? null);

      const selectCurrent = (id: string, token: number) =>
        Effect.map(selectFeed(id), (feed) => (feed?.token === token ? feed : null));

      const updateFeed = (id: string, token: number, change: (feed: Feed) => Feed) =>
        Ref.modify(feeds, (all): readonly [Feed | null, ReadonlyMap<string, Feed>] => {
          const feed = all.get(id);
          if (!feed || feed.token !== token) return [null, all];
          const next = change(feed);
          return [next, new Map(all).set(id, next)];
        });

      const resolveDelay = Effect.fn('TeamFeeds.resolveDelay')(function* (gone: boolean, attempt: number) {
        const step = yield* Schedule.toStep(gone ? TEAM_REFUSED_RETRY : TEAM_RETRY);
        let delay = Duration.zero;
        for (let index = 0; index <= attempt; index += 1) {
          const next = yield* Effect.option(step(0, undefined));
          if (Option.isSome(next)) delay = next.value[1];
        }
        return delay;
      });

      const publish = Effect.gen(function* () {
        yield* Effect.forEach([...listeners], (listener) => listener, { discard: true });
        const now = yield* Clock.currentTimeMillis;
        const key = [...(yield* Ref.get(feeds)).values()]
          .filter((feed) => isHeld(feed, now))
          .map((feed) => `${feed.teamId} ${feed.machine.id} ${feed.updatedAt}`)
          .join('\n');
        if (key === (yield* Ref.getAndSet(heldKey, key))) return;
        yield* Effect.forEach([...heldListeners], (listener) => listener, { discard: true });
      });

      const isWatching = Effect.gen(function* () {
        const file = yield* store.file;
        return (yield* remote.isEnabled) && Boolean(file.credentials?.instanceId);
      });

      const removeViews = (teamId: string, instanceId: string, keep: ReadonlySet<string> = new Set()) =>
        views.removeWhere(
          (entry) => entry.teamId === teamId && entry.instanceId === instanceId && !keep.has(entry.taskId)
        );

      const halt = Effect.fn('TeamFeeds.halt')(function* (id: string) {
        yield* FiberMap.remove(refreshes, id);
        yield* FiberMap.remove(links, id);
      });

      const keep = (feed: Feed, updatedAt: number) =>
        snapshots.write({
          teamId: feed.teamId,
          instanceId: feed.machine.id,
          keyDigest: feed.keyDigest,
          tasks: feed.tasks,
          updatedAt,
          snapshot: feed.snapshot,
        });

      const forget = Effect.fn('TeamFeeds.forget')(function* (id: string, token: number) {
        const feed = yield* updateFeed(id, token, (before) => ({
          ...before,
          tasks: [],
          updatedAt: null,
          snapshot: null,
        }));
        if (!feed) return;
        yield* snapshots.remove(feed.teamId, feed.machine.id);
        yield* removeViews(feed.teamId, feed.machine.id);
      });

      const connect = Effect.fn('TeamFeeds.connect')(function* (
        target: TeamStreamTarget,
        onMessage: (message: ShareMessage) => Effect.Effect<void, TeamFeedUnreadable>
      ) {
        return yield* Effect.gen(function* () {
          const credentials = (yield* store.file).credentials;
          if (!credentials) return refused;
          const url = yield* requestTeamConnect(credentials.machineToken, target.teamId, target.instanceId);
          if (!url) return refused;
          const ephemeral = yield* createEphemeralKeys;
          const hello = yield* createTeamHello(
            target.teamId,
            target.key,
            target.view,
            ephemeral.publicKey,
            'machine'
          ).pipe(Effect.mapError(unreachable));
          const origin = appOrigin;
          const events = yield* Queue.unbounded<FeedSocketEvent>();
          const socket = yield* Effect.acquireRelease(
            Effect.try({
              try: () => {
                const opened = settings.createSocket(url, origin);
                opened.binaryType = 'arraybuffer';
                opened.addEventListener('open', () => Queue.offerUnsafe(events, { type: 'open' }));
                opened.addEventListener('close', () => Queue.offerUnsafe(events, { type: 'close' }));
                opened.addEventListener('message', (event) =>
                  Queue.offerUnsafe(events, { type: 'message', data: event.data })
                );
                return opened;
              },
              catch: unreachable,
            }),
            (opened) => Effect.sync(() => opened.close())
          );
          let openFrame: ((frame: Bytes) => Effect.Effect<Bytes, FrameError>) | null = null;

          const readWelcome = Effect.fn('TeamFeeds.readWelcome')(function* (text: string) {
            const welcome = yield* Effect.try({ try: () => parseShareWelcome(text), catch: unreadable });
            if (welcome?.type === 'refused') return { reason: welcome.reason, gone: true };
            if (welcome?.type !== 'welcome' || openFrame) return offline;
            const keys = {
              team: target.teamId,
              view: target.view,
              clientEphemeral: hello.ephemeral,
              serverEphemeral: welcome.ephemeral,
            };
            const verified = yield* verifyTeamWelcome(target.key, keys, welcome.proof);
            if (!verified) return refused;
            const session = yield* deriveTeamSessionKey(
              target.key,
              keys,
              ephemeral.privateKey,
              welcome.ephemeral
            ).pipe(Effect.mapError(unreadable));
            openFrame = createFrameOpener(session);
            return null;
          });

          const readFrame = Effect.fn('TeamFeeds.readFrame')(function* (data: unknown) {
            const opener = openFrame;
            if (!(data instanceof ArrayBuffer && opener)) return offline;
            const frame = new Uint8Array(data) as Bytes;
            const opened = yield* opener(frame).pipe(Effect.mapError(unreadable));
            const message = yield* Effect.try({
              try: () => parseShareMessage(decodeText(opened)),
              catch: unreadable,
            });
            if (!message) return offline;
            if (message.t === 'closed') return { reason: message.reason, gone: true };
            yield* onMessage(message);
            return null;
          });

          for (;;) {
            const event = yield* Queue.take(events);
            if (event.type === 'open') {
              yield* Effect.sync(() => socket.send(JSON.stringify(hello)));
              continue;
            }
            if (event.type === 'close') return offline;
            const read = typeof event.data === 'string' ? readWelcome(event.data) : readFrame(event.data);
            const end = yield* read.pipe(
              Effect.catchTag('TeamFeedUnreadable', (failure) =>
                Effect.logWarning('[Teams] Could not read a teammate’s machine').pipe(
                  Effect.annotateLogs({ error: failure.message }),
                  Effect.as(offline)
                )
              )
            );
            if (end) return end;
          }
        }).pipe(
          Effect.scoped,
          Effect.catchTag('TeamConnectFailed', (failure) =>
            failure.tag === 'NotOwner' || failure.tag === 'NotFound'
              ? Effect.succeed(refused)
              : Effect.logWarning('[Teams] Could not reach a teammate’s machine').pipe(
                  Effect.annotateLogs({
                    teamId: target.teamId,
                    instanceId: target.instanceId,
                    error: failure.message,
                  }),
                  Effect.as(offline)
                )
          )
        );
      });

      const stream = Effect.fn('TeamFeeds.stream')(function* (
        target: TeamStreamTarget,
        onMessage: (message: ShareMessage) => Effect.Effect<void, TeamFeedUnreadable>
      ) {
        return yield* Effect.gen(function* () {
          const connection = yield* Effect.forkScoped(connect(target, onMessage));
          yield* Effect.asVoid(
            Effect.acquireRelease(acquireAccess(Fiber.interrupt(connection)), (release) => release)
          );
          const exit = yield* Fiber.await(connection);
          return Exit.isSuccess(exit) ? exit.value : null;
        }).pipe(Effect.scoped);
      });

      const keepView = Effect.fn('TeamFeeds.keepView')(function* (
        id: string,
        token: number,
        taskId: string,
        recorder: TeamViewRecorder
      ) {
        const { updatedAt } = recorder;
        const feed = yield* selectCurrent(id, token);
        if (updatedAt === null || !feed) return;
        yield* views.write({
          teamId: feed.teamId,
          instanceId: feed.machine.id,
          taskId,
          keyDigest: feed.keyDigest,
          updatedAt,
          messages: recorder.messages(),
        });
      });

      const fetchView = Effect.fn('TeamFeeds.fetchView')(function* (feed: Feed, taskId: string) {
        const recorder = createTeamViewRecorder();
        const complete = yield* Deferred.make<boolean>();
        const fetched = stream(
          { teamId: feed.teamId, instanceId: feed.machine.id, key: feed.key, view: { kind: 'task', taskId } },
          Effect.fn('TeamFeeds.recordView')(function* (message: ShareMessage) {
            recorder.receive(message);
            if (recorder.isComplete) yield* Deferred.succeed(complete, false);
          })
        ).pipe(Effect.flatMap((end) => (end ? Effect.succeed(end.gone) : Effect.never)));
        const gone = yield* Effect.raceAll([
          settings.waitForViews(TEAM_VIEW_FETCH_TIMEOUT).pipe(Effect.as(false)),
          fetched,
          Deferred.await(complete),
        ]);
        if (!gone) return yield* keepView(feed.id, feed.token, taskId, recorder);
        yield* views.removeWhere(
          (entry) =>
            entry.teamId === feed.teamId && entry.instanceId === feed.machine.id && entry.taskId === taskId
        );
      });

      const isViewStale = Effect.fn('TeamFeeds.isViewStale')(function* (feed: Feed, task: TeamTask) {
        const held = yield* views.selectEntry(feed.teamId, feed.machine.id, task.task.id);
        return !held || held.keyDigest !== feed.keyDigest || held.updatedAt < task.task.updatedAt;
      });

      const refreshViews = Effect.fn('TeamFeeds.refreshViews')(function* (id: string, token: number) {
        const feed = yield* selectCurrent(id, token);
        for (const task of feed?.tasks ?? []) {
          const current = yield* selectCurrent(id, token);
          if (!(current && current.status === 'live')) return;
          if (yield* isViewStale(current, task)) yield* fetchView(current, task.task.id);
        }
      });

      const scheduleViews = Effect.fn('TeamFeeds.scheduleViews')(function* (id: string, token: number) {
        if (yield* FiberMap.has(refreshes, id)) return;
        yield* FiberMap.run(
          refreshes,
          id,
          settings.waitForViews(TEAM_VIEW_REFRESH).pipe(Effect.andThen(refreshViews(id, token)))
        );
      });

      const closeHeldRelays = Effect.fn('TeamFeeds.closeHeldRelays')(function* (id: string) {
        const closes = (yield* Ref.get(heldRelays)).get(id);
        for (const close of closes?.values() ?? []) yield* close;
      });

      const adoptHeld = Effect.fn('TeamFeeds.adoptHeld')(function* (
        teamId: string,
        held: readonly TeamSnapshot[]
      ) {
        let adopted = false;
        for (const snapshot of held) {
          const instanceId = yield* Effect.try({
            try: () => selectTeamSnapshotSigner(snapshot),
            catch: unreadable,
          });
          const feed = instanceId ? yield* selectFeed(resolveFeedKey(teamId, instanceId)) : null;
          const signingKey = feed?.machine.signingKey;
          if (!(feed && signingKey && canAdopt(feed))) continue;
          const body = yield* verifyTeamSnapshot(signingKey, snapshot);
          const current = yield* selectCurrent(feed.id, feed.token);
          if (
            !(
              body &&
              body.teamId === teamId &&
              body.instanceId === instanceId &&
              current &&
              canAdopt(current)
            )
          )
            continue;
          const now = yield* Clock.currentTimeMillis;
          if (isTeamSnapshotExpired(body.updatedAt, now) || (current.updatedAt ?? -1) >= body.updatedAt)
            continue;
          const next = yield* updateFeed(feed.id, feed.token, (before) => ({
            ...before,
            tasks: body.tasks,
            updatedAt: body.updatedAt,
            snapshot,
          }));
          if (next) yield* keep(next, body.updatedAt);
          adopted = true;
        }
        if (adopted) yield* publish;
      });

      const receiveList = Effect.fn('TeamFeeds.receiveList')(function* (
        id: string,
        token: number,
        message: ShareMessage
      ) {
        if (message.t !== 'view' || !(yield* selectCurrent(id, token))) return;
        const list = yield* decodeList(message.data).pipe(Effect.mapError(unreadable));
        const feed = yield* updateFeed(id, token, (before) => ({
          ...before,
          tasks: list.tasks as TeamTask[],
          presence: (list.presence ?? []) as TeamPresence[],
          updatedAt: list.updatedAt,
          snapshot: (list.snapshot as TeamSnapshot | undefined) ?? null,
          attempt: 0,
          status: 'live',
          reason: null,
        }));
        if (!feed) return;
        yield* closeHeldRelays(id);
        yield* keep(feed, list.updatedAt);
        yield* removeViews(feed.teamId, feed.machine.id, new Set(feed.tasks.map((task) => task.task.id)));
        yield* scheduleViews(id, token);
        yield* publish;
        yield* Effect.forkIn(
          adoptHeld(feed.teamId, (list.held ?? []) as TeamSnapshot[]).pipe(
            Effect.catchTag('TeamFeedUnreadable', (failure) =>
              Effect.logWarning('[Teams] Could not check a teammate’s kept snapshots').pipe(
                Effect.annotateLogs({ error: failure.message })
              )
            )
          ),
          scope
        );
      });

      const markOffline = (id: string, token: number) =>
        updateFeed(id, token, (before) => ({
          ...before,
          status: 'offline',
          reason: TEAM_FEED_OFFLINE,
          presence: [],
        }));

      const watch = Effect.fn('TeamFeeds.watch')(function* (id: string, token: number) {
        for (;;) {
          const feed = yield* updateFeed(id, token, (before) =>
            before.status === 'live' ? before : { ...before, status: 'connecting', reason: null }
          );
          if (!feed) return;
          const end = yield* stream(
            { teamId: feed.teamId, instanceId: feed.machine.id, key: feed.key, view: { kind: 'list' } },
            (message) => receiveList(id, token, message)
          );
          if (end === null) return yield* Effect.never;
          if (!(yield* selectCurrent(id, token))) return;
          if (end.gone) yield* forget(id, token);
          const ended = yield* updateFeed(id, token, (before) => ({
            ...before,
            status: end.gone ? 'refused' : 'offline',
            reason: end.reason,
            presence: [],
            attempt: before.attempt + 1,
          }));
          if (!ended) return;
          yield* publish;
          yield* settings.wait(yield* resolveDelay(end.gone, ended.attempt - 1));
        }
      });

      const reconcile = Effect.fn('TeamFeeds.reconcile')(function* (feed: Feed) {
        if (!feed.machine.online) {
          yield* halt(feed.id);
          yield* markOffline(feed.id, feed.token);
          return;
        }
        if (yield* FiberMap.has(links, feed.id)) return;
        yield* FiberMap.run(links, feed.id, watch(feed.id, feed.token));
      });

      const createFeed = Effect.fn('TeamFeeds.createFeed')(function* (
        id: string,
        teamId: string,
        key: string,
        machine: TeamMachine
      ) {
        const keyDigest = resolveKeyDigest(key);
        const stored = yield* snapshots.select(teamId, machine.id);
        const now = yield* Clock.currentTimeMillis;
        const held =
          stored && stored.keyDigest === keyDigest && !isTeamSnapshotExpired(stored.updatedAt, now)
            ? stored
            : null;
        const feed: Feed = {
          id,
          token: yield* nextId,
          teamId,
          key,
          keyDigest,
          machine,
          status: 'connecting',
          reason: null,
          tasks: held?.tasks ?? [],
          presence: [],
          updatedAt: held?.updatedAt ?? null,
          snapshot: held?.snapshot ?? null,
          attempt: 0,
        };
        return feed;
      });

      const listWatchedMachines = Effect.gen(function* () {
        const file = yield* store.file;
        const own = file.credentials?.instanceId ?? null;
        if (!((yield* isWatching) && own)) return [];
        return file.teams.flatMap((team) => {
          const stored = file.teamKeys.find((entry) => entry.teamId === team.id);
          if (!stored) return [];
          return team.machines
            .filter((machine) => machine.id !== own)
            .map((machine) => ({ teamId: team.id, key: stored.key, machine }));
        });
      });

      const pruneSnapshots = Effect.gen(function* () {
        const file = yield* store.file;
        const now = yield* Clock.currentTimeMillis;
        const held = yield* snapshots.list;
        if (!file.credentials?.instanceId) {
          for (const list of held) yield* snapshots.remove(list.teamId, list.instanceId);
          return yield* views.removeWhere(() => true);
        }
        if (!(yield* isWatching)) {
          for (const list of held)
            if (isTeamSnapshotExpired(list.updatedAt, now))
              yield* snapshots.remove(list.teamId, list.instanceId);
          const kept = new Set(
            (yield* snapshots.list).map((list) => resolveFeedKey(list.teamId, list.instanceId))
          );
          return yield* views.removeWhere(
            (entry) => !kept.has(resolveFeedKey(entry.teamId, entry.instanceId))
          );
        }
        const all = yield* Ref.get(feeds);
        for (const list of held) {
          const feed = all.get(resolveFeedKey(list.teamId, list.instanceId));
          if (feed && feed.updatedAt !== null && !isExpired(feed, now)) continue;
          yield* snapshots.remove(list.teamId, list.instanceId);
        }
        yield* views.removeWhere((entry) => {
          const feed = all.get(resolveFeedKey(entry.teamId, entry.instanceId));
          return (
            !feed || feed.updatedAt === null || feed.keyDigest !== entry.keyDigest || isExpired(feed, now)
          );
        });
      });

      const sync = Effect.gen(function* () {
        const kept = new Set<string>();
        for (const { teamId, key, machine } of yield* listWatchedMachines) {
          const id = resolveFeedKey(teamId, machine.id);
          kept.add(id);
          const existing = yield* selectFeed(id);
          if (existing && existing.key !== key) {
            yield* halt(id);
            yield* Ref.update(feeds, dropKey(id));
            yield* snapshots.remove(teamId, machine.id);
            yield* removeViews(teamId, machine.id);
          }
          const feed: Feed = {
            ...((yield* selectFeed(id)) ?? (yield* createFeed(id, teamId, key, machine))),
            machine,
          };
          yield* Ref.update(feeds, (all) => new Map(all).set(id, feed));
          yield* reconcile(feed);
        }
        for (const id of (yield* Ref.get(feeds)).keys()) {
          if (kept.has(id)) continue;
          yield* halt(id);
          yield* Ref.update(feeds, dropKey(id));
        }
        yield* pruneSnapshots;
        yield* publish;
      });

      const start = Effect.andThen(Ref.set(started, true), sync);

      const changed = Effect.gen(function* () {
        if (yield* Ref.get(started)) yield* sync;
      });

      const stop = Effect.gen(function* () {
        yield* Ref.set(started, false);
        yield* FiberMap.clear(refreshes);
        yield* FiberMap.clear(links);
        yield* Ref.set(feeds, new Map());
        for (const close of [...(yield* Ref.get(relays)).values()]) yield* close;
        yield* Ref.set(relays, new Map());
        for (const closes of [...(yield* Ref.get(heldRelays)).values()])
          for (const close of closes.values()) yield* close;
        yield* Ref.set(heldRelays, new Map());
      });

      const observeIn = (set: Set<Effect.Effect<void>>) => (listener: Effect.Effect<void>) =>
        Effect.acquireRelease(
          Effect.sync(() => set.add(listener)),
          () => Effect.sync(() => set.delete(listener))
        ).pipe(Effect.asVoid);

      const listHeld = Effect.fn('TeamFeeds.listHeld')(function* (teamId: string) {
        const now = yield* Clock.currentTimeMillis;
        return [...(yield* Ref.get(feeds)).values()].flatMap((feed) =>
          feed.teamId === teamId && feed.snapshot && isHeld(feed, now) ? [feed.snapshot] : []
        );
      });

      const snapshot = Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const all = [...(yield* Ref.get(feeds)).values()];
        const machines: TeamFeedMachine[] = all.map((feed) => ({
          teamId: feed.teamId,
          instanceId: feed.machine.id,
          name: feed.machine.name,
          userId: feed.machine.userId,
          status: feed.status,
          reason: feed.reason,
          ...(feed.updatedAt === null || isExpired(feed, now) ? {} : { updatedAt: feed.updatedAt }),
          ...(feed.presence.length > 0 ? { presence: feed.presence } : {}),
        }));
        const tasks: TeamFeedTask[] = all.flatMap((feed) =>
          isExpired(feed, now)
            ? []
            : feed.tasks.map((task) => ({ ...task, teamId: feed.teamId, instanceId: feed.machine.id }))
        );
        const answer: TeamFeedSnapshot = { machines, tasks };
        return answer;
      });

      const listTasks = (filter: TeamTaskFilter) =>
        Effect.map(snapshot, ({ tasks }) =>
          tasks.filter(
            (task) =>
              (!filter.teamId || task.teamId === filter.teamId) && !(filter.open && isTaskSettled(task.task))
          )
        );

      const openHeldRelay = Effect.fn('TeamFeeds.openHeldRelay')(function* (
        peer: ChannelPeer,
        feed: Feed,
        target: TeamViewTarget
      ) {
        if (feed.status === 'live' || isExpired(feed, yield* Clock.currentTimeMillis)) return null;
        const held = yield* views.select(target.teamId, target.instanceId, target.taskId);
        if (!(held && held.keyDigest === feed.keyDigest)) return null;
        yield* Effect.sync(() => {
          for (const message of held.messages) peer.send(serializeShareMessage(message));
        });
        const closeId = yield* nextId;
        let release: Effect.Effect<void> = Effect.void;
        const unregister = Ref.modify(
          heldRelays,
          (all): readonly [boolean, ReadonlyMap<string, HeldCloses>] => {
            const closes = all.get(feed.id);
            if (!closes?.has(closeId)) return [false, all];
            const rest: HeldCloses = dropKey<number, Effect.Effect<void>>(closeId)(closes);
            if (rest.size === 0) return [true, dropKey<string, HeldCloses>(feed.id)(all)];
            return [true, new Map(all).set(feed.id, rest)];
          }
        ).pipe(Effect.tap((removed) => (removed ? release : Effect.void)));
        const close = Effect.gen(function* () {
          if (yield* unregister) yield* Effect.sync(() => peer.close(NORMAL_CLOSE, TEAM_FEED_OFFLINE));
        });
        release = yield* acquireAccess(close);
        yield* Ref.update(heldRelays, (all) =>
          new Map(all).set(feed.id, new Map(all.get(feed.id) ?? []).set(closeId, close))
        );
        const relay: TeamRelay = { close: Effect.asVoid(unregister) };
        return relay;
      });

      const openRelay = Effect.fn('TeamFeeds.openRelay')(function* (
        peer: ChannelPeer,
        target: TeamViewTarget
      ) {
        const feed = yield* selectFeed(resolveFeedKey(target.teamId, target.instanceId));
        if (!feed) {
          yield* Effect.sync(() => peer.close(POLICY_VIOLATION, TEAM_VIEW_GONE));
          const gone: TeamRelay = { close: Effect.void };
          return gone;
        }
        const held = yield* openHeldRelay(peer, feed, target);
        if (held) return held;
        const recorder = createTeamViewRecorder();
        const open = yield* Ref.make(true);
        const relayId = yield* nextId;
        const send = (reason: string, closedReason: string) =>
          Effect.sync(() => {
            peer.send(serializeShareMessage({ t: 'closed', reason }));
            peer.close(NORMAL_CLOSE, closedReason);
          });
        const relayed = stream(
          {
            teamId: target.teamId,
            instanceId: target.instanceId,
            key: feed.key,
            view: { kind: 'task', taskId: target.taskId },
          },
          Effect.fn('TeamFeeds.relayMessage')(function* (message: ShareMessage) {
            if (!(yield* Ref.get(open))) return;
            yield* Effect.sync(() => peer.send(serializeShareMessage(message)));
            if (recorder.receive(message)) yield* keepView(feed.id, feed.token, target.taskId, recorder);
          })
        ).pipe(
          Effect.flatMap(
            Effect.fn('TeamFeeds.endRelay')(function* (end: TeamStreamEnd | null) {
              if (!(yield* Ref.getAndSet(open, false))) return;
              yield* Ref.update(relays, dropKey(relayId));
              if (end) yield* send(end.gone ? end.reason : TEAM_FEED_OFFLINE, end.reason);
              else yield* send(TEAM_FEED_OFFLINE, TEAM_FEED_OFFLINE);
            })
          )
        );
        const running = yield* Effect.forkIn(relayed, scope);
        const stopRelay = Effect.gen(function* () {
          if (!(yield* Ref.getAndSet(open, false))) return;
          yield* Ref.update(relays, dropKey(relayId));
          yield* Fiber.interrupt(running);
        });
        yield* Ref.update(relays, (all) => new Map(all).set(relayId, stopRelay));
        const relay: TeamRelay = { close: stopRelay };
        return relay;
      });

      const openStream = (target: TeamStreamTarget, handlers: TeamStreamHandlers) =>
        stream(target, (message) => Effect.sync(() => handlers.onMessage(message))).pipe(
          Effect.flatMap((end) => (end ? Effect.sync(() => handlers.onEnd(end)) : Effect.void))
        );

      yield* remote.observe(changed);

      return TeamFeeds.of({
        start,
        stop,
        sync,
        observe: observeIn(listeners),
        observeHeld: observeIn(heldListeners),
        listHeld,
        snapshot,
        listTasks,
        openRelay,
        openStream,
      });
    })
  );
}
