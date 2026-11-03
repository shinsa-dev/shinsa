import { randomBytes, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { type ConnectChannel, type ConnectClaim, serializeBase64Url } from '@shinsa/core';
import { Effect, Layer, ManagedRuntime } from 'effect';
import { describeError } from '../log/redact.ts';
import { JsonLogger } from '../log/service.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import { resolveBrowserCommand } from '../shell/browser.ts';
import { runCommandOrThrow } from '../shell/index.ts';
import { RemoteAccessScope } from './access/index.ts';
import { type ChannelPeer, RemoteChannel } from './channel.ts';
import { RemoteControl } from './client/index.ts';
import {
  type ChannelParts,
  type GuestLeaver,
  type HandoffClaimer,
  HandoffClaimFailed,
  RemoteKeyUnreadable,
  type RemoteOptions,
  RemoteUrlUnopened,
  SECRET_BYTES,
} from './machine/schema.ts';
import { makeRemote } from './machine/service.ts';
import { RemoteStore } from './store.ts';
import { Tunnel } from './tunnel/index.ts';

export { type ChannelPeer, RemoteChannel } from './channel.ts';
export { createInstalledConnector } from './connector/installed.ts';
export { createRefusedConnector } from './connector/refused.ts';
export { TunnelConnectFailed } from './connector/schema.ts';
export { TunnelConnector } from './connector/service.ts';
export type { TunnelConnectorLayer } from './tunnel/index.ts';
export { RemoteControl } from './client/index.ts';
export { REMOTE_FILE, RemoteStore } from './store.ts';
export type { GuestLeaver, HandoffClaimer, RemoteOptions } from './machine/schema.ts';
export type { RemoteSnapshot } from '@shinsa/core';

type RemoteHandle = Effect.Success<ReturnType<typeof makeRemote>>;

type RemoteRuntime = ManagedRuntime.ManagedRuntime<Layer.Success<RemoteControl['layer']>, never>;

export function resolveMachineName(name = hostname()) {
  const bare = name.replace(/\.local$/i, '');
  if (!bare) return 'Machine';
  if (bare !== bare.toUpperCase()) return bare;
  return bare
    .toLowerCase()
    .replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

export function openRemoteUrl(url: string, cwd: string, command = resolveBrowserCommand(url)) {
  const open = command
    ? Effect.tryPromise({
        try: () => runCommandOrThrow(command, cwd),
        catch: (error) => new RemoteUrlUnopened({ message: describeError(error) }),
      })
    : Effect.void;
  return edgeRuntime.runPromise(Effect.asVoid(open));
}

export function createUrlOpener(cwd: string) {
  return (url: string) => openRemoteUrl(url, cwd);
}

export class Remote {
  readonly store: RemoteStore;
  readonly control: RemoteControl;
  readonly access = new RemoteAccessScope();
  readonly #options: RemoteOptions;
  readonly #tunnel: Tunnel;
  readonly #runtime: RemoteRuntime;
  readonly #handle: RemoteHandle;

  constructor(options: RemoteOptions) {
    this.#options = options;
    const now = options.now ?? Date.now;
    this.store = new RemoteStore(options.path);
    this.control = options.control ?? new RemoteControl();
    this.#runtime = ManagedRuntime.make(this.control.layer.pipe(Layer.provideMerge(JsonLogger)));
    this.#tunnel = new Tunnel({
      control: this.control,
      connector: options.connector,
      ping: options.ping,
      version: options.version,
      localUrl: options.localUrl,
      signingKey: () => this.#runtime.runPromise(this.#handle.signingKey),
      guestRevision: () => this.#runtime.runSync(this.#handle.guestRevision),
      guests: () => this.store.file.guests,
      onAccess: (access, guests) => this.#runtime.runSync(this.#handle.recordAccess(access, guests)),
      onTeams: (teams) => this.#runtime.runSync(this.#handle.recordTeams(teams)),
      onStatus: (status) => this.#runtime.runSync(this.#handle.recordStatus(status)),
      onRevoked: () => this.#runtime.runSync(this.#handle.forget),
    });
    const tunnel = this.#tunnel;
    const access = this.access;
    const runtime = this.#runtime;
    const toKeyFailure = (error: unknown) => new RemoteKeyUnreadable({ message: describeError(error) });
    this.#handle = this.#runtime.runSync(
      makeRemote({
        store: this.store,
        origin: this.control.origin,
        machineName: options.machineName,
        version: options.version,
        now: Effect.sync(now),
        secret: Effect.sync(() => serializeBase64Url(new Uint8Array(randomBytes(SECRET_BYTES)))),
        newId: Effect.sync(randomUUID),
        machineKey: Effect.tryPromise({ try: () => this.store.resolveMachineKey(), catch: toKeyFailure }),
        signingKey: Effect.tryPromise({
          try: () => this.store.resolveSigningKey(),
          catch: toKeyFailure,
        }).pipe(Effect.map((key) => key.publicKey)),
        openUrl: (url) =>
          Effect.tryPromise({
            try: () => options.openUrl(url),
            catch: (error) => new RemoteUrlUnopened({ message: describeError(error) }),
          }),
        tunnel: {
          start: (credentials) => Effect.sync(() => tunnel.start(credentials)),
          stop: Effect.promise(() => tunnel.stop()),
        },
        access: {
          acquire: (close) =>
            Effect.sync(() => {
              const release = access.acquire(() => runtime.runSync(close));
              return Effect.sync(release);
            }),
          end: Effect.sync(() => access.end()),
        },
      })
    );
  }

  get appOrigin() {
    return this.control.origin;
  }

  get isEnabled() {
    return this.#runtime.runSync(this.#handle.isEnabled);
  }

  get tunnelHost() {
    return this.#runtime.runSync(this.#handle.tunnelHost);
  }

  snapshot() {
    return this.#runtime.runSync(this.#handle.snapshot);
  }

  startPairing() {
    return this.#runtime.runPromise(this.#handle.startPairing);
  }

  resolveHookUrl(scheduleId: string, token: string) {
    return this.#runtime.runSync(this.#handle.resolveHookUrl(scheduleId, token));
  }

  cancelPairing() {
    this.#runtime.runSync(this.#handle.cancelPairing);
  }

  enable() {
    this.#runtime.runSync(this.#handle.enable);
  }

  disable() {
    return this.#runtime.runPromise(this.#handle.disable);
  }

  remove() {
    return this.#runtime.runPromise(this.#handle.remove);
  }

  createLink() {
    return this.#runtime.runPromise(this.#handle.createLink);
  }

  removeLink() {
    return this.#runtime.runPromise(this.#handle.removeLink);
  }

  handleClaims(claimer: HandoffClaimer) {
    this.#runtime.runSync(
      this.#handle.handleClaims((taskId, guest) =>
        Effect.tryPromise({
          try: () => claimer(taskId, guest),
          catch: (error) => new HandoffClaimFailed({ message: describeError(error) }),
        })
      )
    );
  }

  handleLeaves(leaver: GuestLeaver) {
    this.#runtime.runSync(this.#handle.handleLeaves(leaver));
  }

  createHandoff(taskId: string) {
    return this.#runtime.runPromise(this.#handle.createHandoff(taskId));
  }

  removeHandoff(taskId: string, guestId: string | null) {
    return this.#runtime.runPromise(this.#handle.removeHandoff(taskId, guestId));
  }

  grantTeammate(userId: string, teamId: string) {
    return this.#runtime.runPromise(this.#handle.grantTeammate(userId, teamId));
  }

  acceptRequest(requestId: string) {
    return this.#runtime.runPromise(this.#handle.acceptRequest(requestId));
  }

  declineRequest(requestId: string) {
    this.#runtime.runSync(this.#handle.declineRequest(requestId));
  }

  removeMember(userId: string) {
    return this.#runtime.runPromise(this.#handle.removeMember(userId));
  }

  publish() {
    this.#runtime.runSync(this.#handle.publish);
  }

  subscribe(listener: () => void) {
    return this.#runtime.runSync(this.#handle.subscribe(listener));
  }

  start() {
    this.#runtime.runSync(this.#handle.start);
  }

  requestHeartbeat() {
    return this.#tunnel.requestHeartbeat();
  }

  stop() {
    return this.#runtime.runPromise(this.#handle.stop);
  }

  verifyConnect(token: string | null, channel: ConnectChannel): Promise<ConnectClaim | null> {
    return this.#runtime.runPromise(this.#handle.verifyConnect(token, channel));
  }

  spendConnect(claim: ConnectClaim) {
    return this.#runtime.runSync(this.#handle.spendConnect(claim));
  }

  openChannel(peer: ChannelPeer, parts: ChannelParts, userId: string) {
    const channel = new RemoteChannel(peer, {
      hub: parts.hub,
      respond: (request, guest) => parts.respond(request, guest, userId),
      resolveMachineKey: () => this.store.resolveMachineKey(),
      isEnrolled: (device) => this.#runtime.runSync(this.#handle.admits(device, userId)),
      resolveGuest: (device) => this.#runtime.runSync(this.#handle.resolveGuest(device)),
      requestAccess: (proof, keys, name) =>
        this.#runtime.runPromise(this.#handle.requestAccess(proof, keys, name, userId)),
      resumeAccess: (device) => this.#runtime.runSync(this.#handle.resumeAccess(device, userId)),
      recordSeen: (device) => this.#runtime.runSync(this.#handle.recordSeen(device)),
      maxBodyBytes: this.#options.maxBodyBytes,
    });
    this.#runtime.runSync(this.#handle.trackChannel(channel.handle));
    return channel;
  }

  closeChannel(channel: RemoteChannel) {
    this.#runtime.runSync(this.#handle.closeChannel(channel.handle));
  }

  removeDevice(publicKey: string) {
    return this.#runtime.runSync(this.#handle.removeDevice(publicKey));
  }
}
