import { Schema } from 'effect';
import { FIELD_MESSAGES, NullByDefault } from '../domain/fields.ts';
import { Salvaged, Truncated } from '../domain/salvage.ts';

const Amount = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const ResourceSummary = Schema.Struct({
  cores: Schema.Finite.check(Schema.makeFilter(Number.isInteger), Schema.isGreaterThanOrEqualTo(1)),
  cpuPercent: Amount.check(Schema.isLessThanOrEqualTo(100)),
  memoryUsedBytes: Amount,
  memoryTotalBytes: Amount,
  diskFreeBytes: Schema.NullOr(Amount),
}).check(Schema.makeFilter((summary) => summary.memoryUsedBytes <= summary.memoryTotalBytes));

export type ResourceSummary = typeof ResourceSummary.Type;

export const PLACEMENT_POLICY_LIMITS = { text: 240, perMachine: 20 } as const;

export const PLACEMENT_PROJECT_LIMITS = {
  perMachine: 50,
  name: 120,
  description: 300,
  repositories: 30,
} as const;

const PlacementNames = Schema.mutable(
  Schema.Array(Truncated(PLACEMENT_PROJECT_LIMITS.name)).check(
    Schema.isMaxLength(PLACEMENT_PROJECT_LIMITS.repositories)
  )
);

export const PlacementProject = Schema.Struct({
  name: Truncated(PLACEMENT_PROJECT_LIMITS.name),
  description: Truncated(PLACEMENT_PROJECT_LIMITS.description),
  repositories: PlacementNames,
});

export type PlacementProject = typeof PlacementProject.Type;

export const PlacementPolicies = Schema.mutable(Schema.Array(Schema.String)).check(
  Schema.isMaxLength(PLACEMENT_POLICY_LIMITS.perMachine),
  Schema.makeFilter((policies) =>
    policies.every(
      (policy) => policy.trim().length > 0 && policy.trim().length <= PLACEMENT_POLICY_LIMITS.text
    )
  )
);

const OpenTasks = Schema.Finite.check(Schema.makeFilter(Number.isInteger), Schema.isGreaterThanOrEqualTo(0));

const TaskCapacity = Schema.Finite.check(
  Schema.makeFilter(Number.isInteger),
  Schema.isGreaterThanOrEqualTo(1)
);

export const PlacementCandidate = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Truncated(120),
  policies: PlacementPolicies,
  projects: Schema.mutable(
    Schema.Array(PlacementProject).check(Schema.isMaxLength(PLACEMENT_PROJECT_LIMITS.perMachine))
  ),
  repositories: PlacementNames,
  open: OpenTasks,
  capacity: Schema.NullOr(TaskCapacity),
  resources: NullByDefault(ResourceSummary, FIELD_MESSAGES.object),
});

export type PlacementCandidate = typeof PlacementCandidate.Type;

export const PLACEMENT_LIMITS = { request: 20_000, machines: 20, reason: 240 } as const;

export const PlacementQuestion = Schema.Struct({
  request: Schema.String.check(
    Schema.makeFilter((request) => request.trim().length > 0),
    Schema.isMaxLength(PLACEMENT_LIMITS.request)
  ),
  machines: Schema.mutable(
    Schema.Array(PlacementCandidate).check(
      Schema.isBetweenLength(2, PLACEMENT_LIMITS.machines),
      Schema.makeFilter((machines) => new Set(machines.map((machine) => machine.id)).size === machines.length)
    )
  ),
});

export type PlacementQuestion = typeof PlacementQuestion.Type;

export const PlacementReply = Schema.Struct({
  machine: Schema.String,
  reason: Salvaged(Schema.String, () => ''),
});

export const CONNECT_CHANNELS = ['remote', 'team'] as const;

export const ConnectChannel = Schema.Literals(CONNECT_CHANNELS);

export type ConnectChannel = typeof ConnectChannel.Type;

export const CONNECT_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export class RemoteKeyInvalid extends Schema.TaggedError<
  RemoteKeyInvalid,
  { readonly brand: unique symbol }
>()('RemoteKeyInvalid', { message: Schema.String }) {}

export class FrameError extends Schema.TaggedError<FrameError, { readonly brand: unique symbol }>()(
  'FrameError',
  { message: Schema.String }
) {}
