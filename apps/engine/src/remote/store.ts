import type { RemoteDevice, RemoteTeam } from '@shinsa/core';
import { Effect } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { RemoteFile, RemoteStoreHandle, StoredTeamKey, TeamGrant } from './store/schema.ts';
import { makeRemoteStore } from './store/service.ts';

export type { RemoteDevice } from '@shinsa/core';
export { readAccess, readGuests, readTeams } from './store/decode.ts';
export { listTeamEntries, resolveOwnerProfile } from './store/derive.ts';
export {
  REMOTE_FILE,
  type RemoteFile,
  type StoredHandoff,
  type StoredLink,
  type StoredTeamKey,
  type TeamGrant,
} from './store/schema.ts';

export function readRemoteFile(path: string): RemoteFile {
  return edgeRuntime.runSync(Effect.flatMap(makeRemoteStore({ path }), (store) => store.file));
}

export class RemoteStore {
  readonly path: string;
  readonly #handle: RemoteStoreHandle;

  constructor(path: string) {
    this.path = path;
    this.#handle = edgeRuntime.runSync(makeRemoteStore({ path }));
  }

  get file(): RemoteFile {
    return edgeRuntime.runSync(this.#handle.file);
  }

  update(change: (file: RemoteFile) => RemoteFile) {
    return edgeRuntime.runSync(this.#handle.update(change));
  }

  resolveMachineKey() {
    return edgeRuntime.runPromise(this.#handle.resolveMachineKey);
  }

  resolveSigningKey() {
    return edgeRuntime.runPromise(this.#handle.resolveSigningKey);
  }

  selectDevice(publicKey: string) {
    return edgeRuntime.runSync(this.#handle.selectDevice(publicKey));
  }

  upsertDevice(device: RemoteDevice) {
    edgeRuntime.runSync(this.#handle.upsertDevice(device));
  }

  removeDevicesOutside(userIds: ReadonlySet<string>, guestIds: ReadonlySet<string>) {
    return edgeRuntime.runSync(this.#handle.removeDevicesOutside(userIds, guestIds));
  }

  removeDevice(publicKey: string) {
    return edgeRuntime.runSync(this.#handle.removeDevice(publicKey));
  }

  recordTeams(teams: RemoteTeam[]) {
    return edgeRuntime.runSync(this.#handle.recordTeams(teams));
  }

  selectTeamKey(teamId: string) {
    return edgeRuntime.runSync(this.#handle.selectTeamKey(teamId));
  }

  selectTeam(teamId: string) {
    return edgeRuntime.runSync(this.#handle.selectTeam(teamId));
  }

  upsertTeamKey(stored: StoredTeamKey) {
    edgeRuntime.runSync(this.#handle.upsertTeamKey(stored));
  }

  writeGrant(grant: TeamGrant) {
    edgeRuntime.runSync(this.#handle.writeGrant(grant));
  }

  selectGrant(userId: string) {
    return edgeRuntime.runSync(this.#handle.selectGrant(userId));
  }

  removeGrantsOutside(userIds: ReadonlySet<string>) {
    edgeRuntime.runSync(this.#handle.removeGrantsOutside(userIds));
  }

  removeTeam(teamId: string) {
    edgeRuntime.runSync(this.#handle.removeTeam(teamId));
  }

  recordDeviceSeen(publicKey: string, at: number) {
    edgeRuntime.runSync(this.#handle.recordDeviceSeen(publicKey, at));
  }
}
