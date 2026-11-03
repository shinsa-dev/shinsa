import { dirname, join } from 'node:path';
import type { InstanceId, TeamId, TeamViewTarget } from '@shinsa/core';
import { Duration, Effect, Fiber, Redacted, Scope } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { ChannelPeer } from './channel.ts';
import { RemoteClient } from './client/service.ts';
import type { Remote } from './index.ts';
import { createChannelEphemeral } from './share-channel.ts';
import {
  type FeedSocket,
  TeamConnectFailed,
  type TeamFeedsHandle,
  type TeamFeedsInput,
  type TeamStreamHandlers,
  type TeamStreamTarget,
} from './team-feeds/schema.ts';
import { makeTeamFeeds } from './team-feeds/service.ts';
import { TEAM_SNAPSHOTS_FILE } from './team-snapshots/schema.ts';
import { TEAM_VIEWS_DIR } from './team-views/schema.ts';

export {
  type FeedSocket,
  TEAM_FEED_OFFLINE,
  TEAM_FEED_REFUSED,
  TEAM_VIEW_GONE,
  type TeamStreamHandlers,
  type TeamStreamTarget,
} from './team-feeds/schema.ts';

type FeedRemote = Pick<Remote, 'store' | 'control' | 'access' | 'appOrigin' | 'isEnabled' | 'subscribe'>;

export type TeamFeedsOptions = TeamFeedsInput<FeedRemote>;

function createFeedSocket(url: string, origin: string): FeedSocket {
  return new WebSocket(url, { headers: { Origin: origin } }) as unknown as FeedSocket;
}

function resolveWait(wait: ((ms: number, run: () => void) => () => void) | undefined) {
  if (!wait) return (delay: Duration.Duration) => Effect.sleep(delay);
  return (delay: Duration.Duration) =>
    Effect.callback<void>((resume) => {
      const cancel = wait(Duration.toMillis(delay), () => resume(Effect.void));
      return Effect.sync(cancel);
    });
}

export class TeamFeeds {
  readonly #handle: TeamFeedsHandle;

  constructor(options: TeamFeedsOptions) {
    const { remote } = options;
    const createSocket = options.createSocket ?? createFeedSocket;
    const wait = resolveWait(options.wait);
    const now = options.now ?? Date.now;
    const client = edgeRuntime.runSync(
      RemoteClient.use((remoteClient) => Effect.succeed(remoteClient)).pipe(
        Effect.provide(remote.control.layer)
      )
    );
    this.#handle = edgeRuntime.runSync(
      makeTeamFeeds({
        file: Effect.sync(() => remote.store.file),
        isEnabled: Effect.sync(() => remote.isEnabled),
        appOrigin: Effect.sync(() => remote.appOrigin),
        now: Effect.sync(now),
        createEphemeral: Effect.promise(() => createChannelEphemeral()),
        requestTeamConnect: (token, teamId, instanceId) =>
          client.teams.connect(Redacted.make(token), teamId as TeamId, instanceId as InstanceId).pipe(
            Effect.map((answer) => answer.url),
            Effect.mapError((error) => new TeamConnectFailed({ tag: error._tag, message: error.message }))
          ),
        acquireAccess: (close) =>
          Effect.sync(() => {
            const release = remote.access.acquire(() => edgeRuntime.runSync(close));
            return Effect.sync(release);
          }),
        createSocket,
        wait,
        waitForViews: options.waitForViews ? resolveWait(options.waitForViews) : wait,
        snapshotsPath: options.snapshotsPath ?? join(dirname(remote.store.path), TEAM_SNAPSHOTS_FILE),
        viewsDir: options.viewsDir ?? join(dirname(remote.store.path), TEAM_VIEWS_DIR),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
    remote.subscribe(() => edgeRuntime.runSync(this.#handle.changed));
  }

  start() {
    edgeRuntime.runSync(this.#handle.start);
  }

  stop() {
    edgeRuntime.runSync(this.#handle.stop);
  }

  subscribe(listener: () => void) {
    return edgeRuntime.runSync(this.#handle.subscribe(listener));
  }

  subscribeHeld(listener: () => void) {
    return edgeRuntime.runSync(this.#handle.subscribeHeld(listener));
  }

  sync() {
    edgeRuntime.runSync(this.#handle.sync);
  }

  listHeld(teamId: string) {
    return edgeRuntime.runSync(this.#handle.listHeld(teamId));
  }

  snapshot() {
    return edgeRuntime.runSync(this.#handle.snapshot);
  }

  listTasks(filter: { teamId?: string | null; open?: boolean } = {}) {
    return edgeRuntime.runSync(this.#handle.listTasks(filter));
  }

  openRelay(peer: ChannelPeer, target: TeamViewTarget) {
    const relay = edgeRuntime.runSync(this.#handle.openRelay(peer, target));
    return { close: () => edgeRuntime.runSync(relay.close) };
  }

  openStream(target: TeamStreamTarget, handlers: TeamStreamHandlers) {
    const fiber = edgeRuntime.runFork(this.#handle.openStream(target, handlers));
    return () => {
      edgeRuntime.runSync(Fiber.interrupt(fiber));
    };
  }
}
