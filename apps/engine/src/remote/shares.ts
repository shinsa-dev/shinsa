import type { ShareLiveView, SharePreset } from '@shinsa/core';
import { Effect } from 'effect';
import { describeError } from '../log/index.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import type { EffectContext } from '../runtime/engine.ts';
import type { ChannelPeer } from './channel.ts';
import { type LiveShare, ShareChannel } from './share-channel.ts';
import {
  SHARE_LINK_NAME,
  ShareCodeUnreadable,
  ShareDispatchFailed,
  type ShareEffects,
  type ShareLinks,
  type ShareLive,
  type SharesHandle,
  type SharesOptions,
} from './shares/schema.ts';
import { makeShares } from './shares/service.ts';
import { readWorktreeFile as readWorktreeFileEffect } from './shares/worktree-file.ts';

export {
  SHARE_LINK_LOST,
  SHARE_NOT_PAIRED,
  SHARE_REMOTE_CHANGED,
  type ShareEffects,
  type ShareGitHub,
  type ShareLinks,
  type SharesOptions,
  type ShareTranscripts,
  type ShareWorktree,
} from './shares/schema.ts';

const enterCode = <A>(run: () => Promise<A>) =>
  Effect.tryPromise({
    try: run,
    catch: (error) => new ShareCodeUnreadable({ message: describeError(error) }),
  });

function serveLive(live: ShareLive): LiveShare<ShareLiveView> {
  return {
    view: live.view,
    files: live.files.map((file) => ({
      id: file.id,
      version: file.version,
      type: file.type,
      read: () => edgeRuntime.runPromise(file.read),
    })),
  };
}

export function readWorktreeFile(worktree: string, path: string) {
  return edgeRuntime.runPromise(readWorktreeFileEffect(worktree, path));
}

export class Shares implements ShareEffects, ShareLinks {
  readonly #handle: SharesHandle;

  constructor(options: SharesOptions) {
    const { engine, remote, evidence, transcripts, github, worktree } = options;
    const now = options.now ?? Date.now;
    const random = options.random ?? ((bytes: number) => crypto.getRandomValues(new Uint8Array(bytes)));
    this.#handle = edgeRuntime.runSync(
      makeShares({
        now: Effect.sync(now),
        random: (bytes) => Effect.sync(() => random(bytes)),
        state: Effect.sync(() => engine.state),
        dispatch: (command, id) =>
          Effect.tryPromise({
            try: () => engine.dispatch(command, id === undefined ? undefined : { id }),
            catch: (error) => new ShareDispatchFailed({ message: describeError(error) }),
          }),
        remoteFile: Effect.sync(() => remote.store.file),
        remoteEnabled: Effect.sync(() => remote.isEnabled),
        appOrigin: Effect.sync(() => remote.appOrigin),
        machineName: Effect.sync(() => remote.snapshot().machineName),
        acquireAccess: (close) =>
          Effect.sync(() => {
            const release = remote.access.acquire(() => edgeRuntime.runSync(close));
            return Effect.sync(release);
          }),
        createChannel: (peer, authorize) =>
          Effect.sync(
            () =>
              new ShareChannel<string>(peer, {
                name: SHARE_LINK_NAME,
                authorize: (hello) => edgeRuntime.runPromise(authorize(hello)),
                resolveLive: (taskId) => this.resolveLive(taskId),
              })
          ),
        selectEvidenceFile: (name) => Effect.sync(() => evidence.selectFile(name)),
        listEntries: (runId) => Effect.sync(() => transcripts.listEntries(runId)),
        github: github
          ? {
              readDiff: (repo, number) => enterCode(() => github.readDiff(repo, number)),
              readFile: (repo, ref, path) => enterCode(() => github.readFile(repo, ref, path)),
            }
          : null,
        worktree: worktree
          ? {
              readBase: (repo, task) => enterCode(() => worktree.readBase(repo, task)),
              readPatch: (path, base) => enterCode(() => worktree.readPatch(path, base)),
              readFile: (path, file) => enterCode(() => worktree.readFile(path, file)),
            }
          : null,
      })
    );
    remote.subscribe(() => edgeRuntime.runSync(this.#handle.syncRemote));
    engine.subscribe(() => edgeRuntime.runSync(this.#handle.syncChannels));
    transcripts.subscribe((runId) => edgeRuntime.runSync(this.#handle.pushTranscript(runId)));
  }

  acceptsShare(shareId: string) {
    return edgeRuntime.runSync(this.#handle.acceptsShare(shareId));
  }

  openChannel(peer: ChannelPeer, shareId: string) {
    return edgeRuntime.runSync(this.#handle.openChannel(peer, shareId));
  }

  closeChannel(channel: ShareChannel) {
    edgeRuntime.runSync(this.#handle.closeChannel(channel));
  }

  link(taskId: string, context: EffectContext) {
    return edgeRuntime.runPromise(this.#handle.link(taskId, context));
  }

  resolveLive(taskId: string, preset?: SharePreset) {
    return edgeRuntime.runPromise(Effect.map(this.#handle.resolveLive(taskId, preset), serveLive));
  }
}
