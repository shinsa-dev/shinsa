import { join } from 'node:path';
import {
  parsePrivateKey,
  parseSigningPrivateKey,
  REMOTE_KEY_ALGORITHM,
  type RemoteDevice,
  type RemoteTeam,
  SIGNING_KEY_ALGORITHM,
  serializePrivateKey,
  serializePublicKey,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Ref, SynchronizedRef } from 'effect';
import { EngineConfig } from '../../config/service.ts';
import { JsonFile } from '../../files/service.ts';
import { RemoteFileFields } from '../schema.ts';
import { readRemoteFields } from './decode.ts';
import { createRemoteFile } from './derive.ts';
import {
  type ParsedKeys,
  REMOTE_FILE,
  type RemoteFile,
  type RemoteStoreHandle,
  type ResolvedKey,
  type StoredTeamKey,
  type TeamGrant,
} from './schema.ts';

export class RemoteStore extends Context.Service<RemoteStore, RemoteStoreHandle>()(
  'shinsa/engine/remote/store/RemoteStore'
) {
  static readonly layer = Layer.effect(
    RemoteStore,
    Effect.gen(function* () {
      const json = yield* JsonFile;
      const config = yield* EngineConfig;
      const path = join(config.dataDir, REMOTE_FILE);

      const read = json.read(path, RemoteFileFields).pipe(
        Effect.map((fields) => readRemoteFields(Option.getOrNull(fields))),
        Effect.tap(({ credentialsIncomplete }) =>
          credentialsIncomplete
            ? Effect.logWarning(
                '[Remote] remote.json is missing part of its credentials; pair this machine again'
              )
            : Effect.void
        ),
        Effect.map(({ file }) => file),
        Effect.catchTag('JsonFileUnreadable', (failure) =>
          Effect.logWarning('[Remote] remote.json could not be read; remote access is off').pipe(
            Effect.annotateLogs({ error: failure.reason }),
            Effect.as(createRemoteFile())
          )
        )
      );

      const current = yield* Ref.make<RemoteFile>(yield* read);
      const keys = yield* SynchronizedRef.make<ParsedKeys>({ machine: null, signing: null });
      const file = Ref.get(current);

      const update = Effect.fn('RemoteStore.update')(function* (change: (file: RemoteFile) => RemoteFile) {
        const next = change(yield* file);
        yield* Ref.set(current, next);
        yield* json.write(path, next);
        return next;
      });

      const resolveKey = (
        slot: 'machine' | 'signing',
        parse: (text: string) => Effect.Effect<CryptoKey | null>,
        generate: () => Promise<CryptoKeyPair>
      ) =>
        SynchronizedRef.modifyEffect(
          keys,
          Effect.fn('RemoteStore.resolveKey')(function* (parsed: ParsedKeys) {
            const stored = (yield* file)[slot];
            const known = parsed[slot];
            const key = stored && (known ?? (yield* parse(stored.privateKey)));
            if (stored && key) {
              const resolved: ResolvedKey = { publicKey: stored.publicKey, privateKey: key };
              return [resolved, { ...parsed, [slot]: key }] as const;
            }
            const pair = yield* Effect.promise(generate);
            const fresh = {
              publicKey: yield* serializePublicKey(pair.publicKey),
              privateKey: yield* serializePrivateKey(pair.privateKey),
            };
            yield* update((before) => ({ ...before, [slot]: fresh }));
            const privateKey = (yield* parse(fresh.privateKey)) as CryptoKey;
            const resolved: ResolvedKey = { publicKey: fresh.publicKey, privateKey };
            return [resolved, { ...parsed, [slot]: privateKey }] as const;
          })
        );

      const resolveMachineKey = resolveKey(
        'machine',
        parsePrivateKey,
        () => crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
      );

      const resolveSigningKey = resolveKey(
        'signing',
        parseSigningPrivateKey,
        () =>
          crypto.subtle.generateKey(SIGNING_KEY_ALGORITHM, true, ['sign', 'verify']) as Promise<CryptoKeyPair>
      );

      const selectDevice = (publicKey: string) =>
        Effect.map(file, (stored) => stored.devices.find((device) => device.publicKey === publicKey) ?? null);

      const upsertDevice = (device: RemoteDevice) =>
        Effect.asVoid(
          update((stored) => ({
            ...stored,
            devices: [...stored.devices.filter((entry) => entry.publicKey !== device.publicKey), device],
          }))
        );

      const removeDevicesOutside = Effect.fn('RemoteStore.removeDevicesOutside')(function* (
        userIds: ReadonlySet<string>,
        guestIds: ReadonlySet<string>
      ) {
        const removed = (yield* file).devices.filter(
          (device) => !(device.taskId ? guestIds : userIds).has(device.userId)
        );
        if (removed.length === 0) return [];
        yield* update((stored) => ({
          ...stored,
          devices: stored.devices.filter((device) => !removed.includes(device)),
        }));
        return removed.map((device) => device.publicKey);
      });

      const removeDevice = Effect.fn('RemoteStore.removeDevice')(function* (publicKey: string) {
        const before = (yield* file).devices.length;
        const after = yield* update((stored) => ({
          ...stored,
          devices: stored.devices.filter((device) => device.publicKey !== publicKey),
        }));
        return after.devices.length < before;
      });

      const recordTeams = Effect.fn('RemoteStore.recordTeams')(function* (teams: RemoteTeam[]) {
        const stored = yield* file;
        const kept = stored.teamKeys.flatMap((key) => {
          const team = teams.find((entry) => entry.id === key.teamId);
          if (team) return [{ ...key, name: team.name }];
          return stored.teams.some((entry) => entry.id === key.teamId) ? [] : [key];
        });
        const changed =
          JSON.stringify(teams) !== JSON.stringify(stored.teams) ||
          JSON.stringify(kept) !== JSON.stringify(stored.teamKeys);
        if (changed) yield* update((before) => ({ ...before, teams, teamKeys: kept }));
        return changed;
      });

      const selectTeamKey = (teamId: string) =>
        Effect.map(file, (stored) => stored.teamKeys.find((key) => key.teamId === teamId) ?? null);

      const selectTeam = (teamId: string) =>
        Effect.map(file, (stored) => stored.teams.find((team) => team.id === teamId) ?? null);

      const upsertTeamKey = (key: StoredTeamKey) =>
        Effect.asVoid(
          update((stored) => ({
            ...stored,
            teamKeys: [...stored.teamKeys.filter((entry) => entry.teamId !== key.teamId), key],
          }))
        );

      const writeGrant = (grant: TeamGrant) =>
        Effect.asVoid(
          update((stored) => ({
            ...stored,
            grants: [...stored.grants.filter((entry) => entry.userId !== grant.userId), grant],
          }))
        );

      const selectGrant = (userId: string) =>
        Effect.map(file, (stored) => stored.grants.find((grant) => grant.userId === userId) ?? null);

      const removeGrantsOutside = Effect.fn('RemoteStore.removeGrantsOutside')(function* (
        userIds: ReadonlySet<string>
      ) {
        if ((yield* file).grants.every((grant) => userIds.has(grant.userId))) return;
        yield* update((stored) => ({
          ...stored,
          grants: stored.grants.filter((grant) => userIds.has(grant.userId)),
        }));
      });

      const removeTeam = (teamId: string) =>
        Effect.asVoid(
          update((stored) => ({
            ...stored,
            teams: stored.teams.filter((team) => team.id !== teamId),
            teamKeys: stored.teamKeys.filter((key) => key.teamId !== teamId),
          }))
        );

      const recordDeviceSeen = Effect.fn('RemoteStore.recordDeviceSeen')(function* (
        publicKey: string,
        at: number
      ) {
        if (!(yield* selectDevice(publicKey))) return;
        yield* update((stored) => ({
          ...stored,
          devices: stored.devices.map((device) =>
            device.publicKey === publicKey ? { ...device, lastSeenAt: at } : device
          ),
        }));
      });

      return RemoteStore.of({
        file,
        update,
        resolveMachineKey,
        resolveSigningKey,
        selectDevice,
        upsertDevice,
        removeDevicesOutside,
        removeDevice,
        recordTeams,
        selectTeamKey,
        selectTeam,
        upsertTeamKey,
        writeGrant,
        selectGrant,
        removeGrantsOutside,
        removeTeam,
        recordDeviceSeen,
      });
    })
  );
}
