import {
  type InstanceId,
  decodeText,
  parsePrivateKey,
  parsePublicKey,
  REMOTE_KEY_ALGORITHM,
  serializePrivateKey,
  serializePublicKey,
  type TeamId,
} from '@shinsa/core';
import { serializeEngineFailure } from '@shinsa/core/engine-api/errors';
import type { TeamRelayEntry } from '@shinsa/core/engine-api/schema';
import {
  Clock,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Redacted,
  Result,
  Scope,
  Semaphore,
} from 'effect';
import { describeBodyLimit, resolveBodySizeRefusal } from '../../http/guard.ts';
import type { ChannelPeer } from '../channel/schema.ts';
import { RemoteOrigin } from '../client/schema.ts';
import { RemoteClient } from '../client/service.ts';
import { DeviceChannelError, type DeviceChannelLink } from '../device-channel/schema.ts';
import { DeviceChannels } from '../device-channel/service.ts';
import { Remote } from '../machine/service.ts';
import type { RelayDevice, RemoteFile } from '../store/schema.ts';
import { RemoteStore } from '../store/service.ts';
import { TeamFeeds } from '../team-feeds/service.ts';
import {
  FLEET_RELAY_MESSAGES,
  type FleetRelayHandle,
  RELAY_ABORTED_STATUS,
  RELAY_BODY_LIMIT_BYTES,
  RELAY_BODY_METHODS,
  RELAY_CLOSE,
  RELAY_DROPPED_HEADERS,
  type OpenSocket,
  type RelaySocket,
  type RelayTarget,
} from './schema.ts';

export class FleetRelay extends Context.Service<FleetRelay, FleetRelayHandle>()(
  'shinsa/engine/remote/fleet-relay/FleetRelay'
) {
  static readonly layer = Layer.effect(
    FleetRelay,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const store = yield* RemoteStore;
      const client = yield* RemoteClient;
      const origin = yield* RemoteOrigin;
      const feeds = yield* TeamFeeds;
      const remote = yield* Remote;
      const channels = yield* DeviceChannels;
      const opening = yield* Semaphore.make(1);
      const links = new Map<string, DeviceChannelLink>();
      const sockets = new Set<OpenSocket>();

      const fail = (message: string, refused: boolean) => new DeviceChannelError({ message, refused });

      const respondFailure = (error: DeviceChannelError) =>
        Response.json(
          serializeEngineFailure({
            code: error.refused ? 'relay_refused' : 'relay_failed',
            message: error.message,
          }),
          { status: error.refused ? 403 : 502 }
        );

      const respondTooLarge = () =>
        Response.json(
          serializeEngineFailure({
            code: 'body_too_large',
            message: describeBodyLimit(RELAY_BODY_LIMIT_BYTES),
          }),
          { status: 413 }
        );

      const readRelayBody = Effect.fn('FleetRelay.readBody')(function* (incoming: Request, method: string) {
        if (!RELAY_BODY_METHODS.has(method)) return null;
        if (resolveBodySizeRefusal(incoming, RELAY_BODY_LIMIT_BYTES)) return respondTooLarge();
        const read = yield* Effect.tryPromise(() => incoming.arrayBuffer()).pipe(Effect.result);
        if (Result.isFailure(read)) return new Response(null, { status: RELAY_ABORTED_STATUS });
        if (read.success.byteLength > RELAY_BODY_LIMIT_BYTES) return respondTooLarge();
        return new Uint8Array(read.success);
      });

      const listRelayHeaders = (headers: Headers): [string, string][] =>
        [...headers].filter(([name]) => !(RELAY_DROPPED_HEADERS.has(name) || name.startsWith('sec-')));

      const isKept = (file: RemoteFile, device: RelayDevice, targets: ReadonlyMap<string, RelayTarget>) => {
        const target = targets.get(device.instanceId);
        if (
          target &&
          target.teamId === device.teamId &&
          (target.grant === null || target.machineKey !== device.machineKey)
        )
          return false;
        if (!(file.enabled && file.teamKeys.some((key) => key.teamId === device.teamId))) return false;
        return file.teams.some(
          (team) =>
            team.id === device.teamId && team.machines.some((machine) => machine.id === device.instanceId)
        );
      };

      const listTargets = Effect.map(feeds.listGrants, (grants) => {
        const targets = new Map<string, RelayTarget>();
        for (const entry of grants) {
          const known = targets.get(entry.machine.id);
          if (known?.grant) continue;
          targets.set(entry.machine.id, {
            teamId: entry.teamId,
            instanceId: entry.machine.id,
            name: entry.machine.name,
            userId: entry.machine.userId,
            machineKey: entry.machineKey,
            grant: entry.grant,
          });
        }
        return targets;
      });

      const selectTarget = (instanceId: string) =>
        Effect.map(listTargets, (all) => all.get(instanceId) ?? null);

      const parseKeys = Effect.fn('FleetRelay.parseKeys')(function* (device: RelayDevice) {
        const publicKey = yield* parsePublicKey(device.publicKey);
        const privateKey = yield* parsePrivateKey(device.privateKey);
        if (!(publicKey && privateKey)) return null;
        const keys: CryptoKeyPair = { publicKey, privateKey };
        return keys;
      });

      const dial = Effect.fn('FleetRelay.dial')(function* (
        target: RelayTarget,
        device: CryptoKeyPair,
        enrollSecret: string | null
      ) {
        const credentials = (yield* store.file).credentials;
        if (!credentials) return yield* fail(FLEET_RELAY_MESSAGES.unpaired, true);
        const { url } = yield* client.teams
          .remoteConnect(
            Redacted.make(credentials.machineToken),
            target.teamId as TeamId,
            target.instanceId as InstanceId
          )
          .pipe(Effect.mapError((error) => fail(error.message, error._tag !== 'RemoteUnreachable')));
        return yield* channels.open({
          url,
          origin,
          machineKey: target.machineKey,
          device,
          enrollSecret,
          name: remote.machineName,
        });
      });

      const forgetDevice = (instanceId: string) =>
        store
          .removeRelayDevicesWhere((device) => device.instanceId === instanceId)
          .pipe(
            Effect.mapError((error) => fail(error.message, false)),
            Effect.asVoid
          );

      const resume = Effect.fn('FleetRelay.resume')(function* (target: RelayTarget) {
        const stored = yield* store.selectRelayDevice(target.instanceId);
        if (!stored) return null;
        const keys =
          stored.teamId === target.teamId && stored.machineKey === target.machineKey
            ? yield* parseKeys(stored)
            : null;
        if (!keys) {
          yield* forgetDevice(target.instanceId);
          return null;
        }
        const opened = yield* Effect.exit(dial(target, keys, null));
        if (Exit.isSuccess(opened)) return opened.value;
        const error = opened.cause.reasons.find((reason) => reason._tag === 'Fail');
        if (!(error?._tag === 'Fail' && error.error.refused)) return yield* Effect.failCause(opened.cause);
        yield* forgetDevice(target.instanceId);
        return null;
      });

      const enroll = Effect.fn('FleetRelay.enroll')(function* (target: RelayTarget) {
        if (!target.grant) return yield* fail(FLEET_RELAY_MESSAGES.refused, true);
        const keys = yield* Effect.promise(
          () =>
            crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
        );
        const link = yield* dial(target, keys, target.grant);
        const device: RelayDevice = {
          instanceId: target.instanceId,
          teamId: target.teamId,
          machineKey: target.machineKey,
          publicKey: yield* serializePublicKey(keys.publicKey),
          privateKey: yield* serializePrivateKey(keys.privateKey),
          enrolledAt: yield* Clock.currentTimeMillis,
        };
        yield* store.writeRelayDevice(device).pipe(
          Effect.tapError(() => link.close),
          Effect.mapError((error) => fail(error.message, false))
        );
        return link;
      });

      const openLink = Effect.fn('FleetRelay.openLink')(function* (target: RelayTarget) {
        const file = yield* store.file;
        if (!file.enabled) return yield* fail(FLEET_RELAY_MESSAGES.unpaired, true);
        return (yield* resume(target)) ?? (yield* enroll(target));
      });

      const requestLink = (target: RelayTarget) =>
        Semaphore.withPermit(
          opening,
          Effect.gen(function* () {
            const known = links.get(target.instanceId);
            if (known && (yield* known.isOpen)) return known;
            const link = yield* openLink(target);
            links.set(target.instanceId, link);
            link.subscribeSocket(() => undefined);
            link.subscribeClose(() => {
              if (links.get(target.instanceId) === link) links.delete(target.instanceId);
            });
            return link;
          })
        );

      const socketLink = (target: RelayTarget) => Semaphore.withPermit(opening, openLink(target));

      const list = Effect.gen(function* () {
        const file = yield* store.file;
        if (!file.enabled) return [];
        const targets = yield* listTargets;
        return [...targets.values()].flatMap((target): TeamRelayEntry[] => {
          const enrolled = file.relayDevices.some(
            (device) => device.instanceId === target.instanceId && device.teamId === target.teamId
          );
          if (!(target.grant || enrolled)) return [];
          return [
            {
              instanceId: target.instanceId,
              teamId: target.teamId,
              name: target.name,
              userId: target.userId,
              appOrigin: origin,
            },
          ];
        });
      });

      const request = Effect.fn('FleetRelay.request')(function* (
        instanceId: string,
        path: string,
        incoming: Request
      ) {
        const target = yield* selectTarget(instanceId);
        if (!target) return respondFailure(fail(FLEET_RELAY_MESSAGES.unknown, true));
        const method = incoming.method.toUpperCase();
        const read = yield* readRelayBody(incoming, method);
        if (read instanceof Response) return read;
        const bytes = read;
        const search = new URL(incoming.url).search;
        return yield* requestLink(target).pipe(
          Effect.flatMap((link) =>
            link.request({
              method,
              path: `${path}${search}`,
              headers: listRelayHeaders(incoming.headers),
              body: bytes && bytes.length > 0 ? bytes : null,
              signal: incoming.signal,
            })
          ),
          Effect.catchTag('DeviceRequestAborted', () =>
            Effect.succeed(new Response(null, { status: RELAY_ABORTED_STATUS }))
          ),
          Effect.catchTag('DeviceChannelError', (error) => Effect.succeed(respondFailure(error)))
        );
      });

      const openSocket = Effect.fn('FleetRelay.openSocket')(function* (
        instanceId: string,
        peer: ChannelPeer
      ) {
        const inbound = yield* Queue.unbounded<string>();
        const closePeer = (error: DeviceChannelError) =>
          Effect.sync(() =>
            peer.close(error.refused ? RELAY_CLOSE.refused : RELAY_CLOSE.broke, error.message)
          );
        const relay = Effect.gen(function* () {
          const target = yield* selectTarget(instanceId);
          if (!target) return yield* fail(FLEET_RELAY_MESSAGES.unknown, true);
          const link = yield* Effect.acquireRelease(socketLink(target), (opened) => opened.close);
          const ended = yield* Deferred.make<DeviceChannelError>();
          link.subscribeSocket((data) => peer.send(data));
          link.subscribeClose((error) => Deferred.doneUnsafe(ended, Exit.succeed(error)));
          yield* Effect.forkScoped(
            Effect.forever(Effect.flatMap(Queue.take(inbound), (data) => link.sendSocket(data))).pipe(
              Effect.catch((error) => Deferred.succeed(ended, error))
            )
          );
          return yield* fail((yield* Deferred.await(ended)).message, false);
        }).pipe(Effect.scoped, Effect.catchTag('DeviceChannelError', closePeer));
        const fiber = yield* Effect.forkIn(relay, scope);
        const entry: OpenSocket = {
          instanceId,
          end: Effect.andThen(
            Fiber.interrupt(fiber),
            Effect.sync(() => peer.close(RELAY_CLOSE.refused, FLEET_RELAY_MESSAGES.unknown))
          ),
        };
        sockets.add(entry);
        fiber.addObserver(() => sockets.delete(entry));
        const socket: RelaySocket = {
          receive: (raw) =>
            Queue.offer(inbound, typeof raw === 'string' ? raw : decodeText(raw)).pipe(Effect.asVoid),
          close: Fiber.interrupt(fiber),
        };
        return socket;
      });

      const sync = Effect.gen(function* () {
        const file = yield* store.file;
        const targets = yield* listTargets;
        const reachable = file.enabled ? targets : new Map<string, RelayTarget>();
        for (const [instanceId, link] of [...links]) {
          if (reachable.has(instanceId)) continue;
          links.delete(instanceId);
          yield* link.close;
        }
        for (const socket of [...sockets]) if (!reachable.has(socket.instanceId)) yield* socket.end;
        yield* store
          .removeRelayDevicesWhere((device) => !isKept(file, device, reachable))
          .pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Teams] Could not forget a teammate machine’s relay device').pipe(
                Effect.annotateLogs({ error: error.message })
              )
            )
          );
      });

      yield* feeds.observe(sync);
      yield* remote.observe(sync);
      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          for (const link of links.values()) yield* link.close;
          links.clear();
        })
      );

      return FleetRelay.of({ list, request, openSocket });
    })
  );
}
