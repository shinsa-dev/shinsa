import { InstanceId, RemoteRole, type RemoteUser, RemoteUserId } from '@shinsa/core';
import { Schema } from 'effect';
import { TokenHash } from '../../crypto/schema.ts';

export const Machine = Schema.Struct({
  id: InstanceId,
  userId: RemoteUserId,
  name: Schema.String,
  fingerprint: Schema.String,
  tunnelId: Schema.String,
  dnsRecordId: Schema.String,
  connectKey: Schema.RedactedFromValue(Schema.String),
  localUrl: Schema.NullOr(Schema.String),
  online: Schema.BooleanFromBit,
  lastSeenAt: Schema.NullOr(Schema.Number),
  signingKey: Schema.NullOr(Schema.String),
  createdAt: Schema.Number,
});

export type Machine = typeof Machine.Type;

export const NewMachine = Schema.Struct({
  id: InstanceId,
  userId: RemoteUserId,
  name: Schema.String,
  fingerprint: Schema.String,
  tunnelId: Schema.String,
  dnsRecordId: Schema.String,
  machineTokenHash: TokenHash,
  connectKey: Schema.RedactedFromValue(Schema.String),
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
  'instances.id, instances.user_id, instances.name, instances.fingerprint, instances.tunnel_id, instances.dns_record_id, instances.connect_key, instances.local_url, instances.online, instances.last_seen_at, instances.signing_key, instances.created_at';
