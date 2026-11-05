import { InstanceId, MachineFeatures, RemoteRole, type RemoteUser, RemoteUserId } from '@shinsa/core';
import { Schema } from 'effect';
import { TokenHash } from '../../crypto/schema.ts';

export const StoredFeatures = Schema.fromJsonString(MachineFeatures);

export const Machine = Schema.Struct({
  id: InstanceId,
  ownerId: RemoteUserId,
  name: Schema.String,
  fingerprint: Schema.String,
  tunnelId: Schema.String,
  dnsRecordId: Schema.String,
  connectKey: Schema.RedactedFromValue(Schema.String),
  localUrl: Schema.NullOr(Schema.String),
  online: Schema.BooleanFromBit,
  lastSeenAt: Schema.NullOr(Schema.Number),
  signingKey: Schema.NullOr(Schema.String),
  features: StoredFeatures,
  createdAt: Schema.Number,
});

export type Machine = typeof Machine.Type;

export const NewMachine = Schema.Struct({
  id: InstanceId,
  ownerId: RemoteUserId,
  name: Schema.String,
  fingerprint: Schema.String,
  tunnelId: Schema.String,
  dnsRecordId: Schema.String,
  machineTokenHash: TokenHash,
  connectKey: Schema.RedactedFromValue(Schema.String),
  features: StoredFeatures,
});

export type NewMachine = typeof NewMachine.Type;

export const SharedMachineRow = Schema.Struct({
  ...Machine.fields,
  ownerLogin: Schema.String,
  ownerName: Schema.NullOr(Schema.String),
  ownerAvatarUrl: Schema.NullOr(Schema.String),
  role: RemoteRole,
});

export interface SharedMachine {
  readonly machine: Machine;
  readonly owner: RemoteUser;
  readonly role: RemoteRole;
}

export const MACHINE_COLUMNS =
  'machines.id, machines.owner_id, machines.name, machines.fingerprint, machines.tunnel_id, machines.dns_record_id, machines.connect_key, machines.local_url, machines.online, machines.last_seen_at, machines.signing_key, machines.features, machines.created_at';

export interface MachineBeat {
  readonly localUrl: string;
  readonly signingKey: string | null;
  readonly features: ReadonlyArray<string>;
}
