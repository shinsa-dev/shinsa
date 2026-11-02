import { Schema } from 'effect';

const MachineText = Schema.Trim.check(Schema.isNonEmpty());

const MachineRoots = Schema.Array(MachineText);

export const MAX_PORT = 65_535;

const MachinePort = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: MAX_PORT }));

const MachineTime = Schema.Finite.check(Schema.isGreaterThan(0));

export const MachineConfig = Schema.Struct({
  version: Schema.Literal(1),
  roots: Schema.mutable(MachineRoots),
  onboardedAt: Schema.NullOr(MachineTime),
  port: Schema.NullOr(MachinePort),
  hostname: Schema.NullOr(MachineText),
  editor: Schema.NullOr(MachineText),
  terminal: Schema.NullOr(MachineText),
});
export type MachineConfig = typeof MachineConfig.Type;

export const MachineFields = Schema.Struct({
  roots: Schema.NullishOr(MachineRoots),
  onboardedAt: Schema.NullishOr(MachineTime),
  port: Schema.NullishOr(MachinePort),
  hostname: Schema.NullishOr(MachineText),
  editor: Schema.NullishOr(MachineText),
  terminal: Schema.NullishOr(MachineText),
});

export type MachineField = keyof typeof MachineFields.fields;

export const MACHINE_FIELD_PROBLEMS: Record<MachineField, string> = {
  roots: 'roots must be a list of folders; it was ignored.',
  onboardedAt: 'onboardedAt must be a time; it was ignored.',
  port: 'port must be a port number; it was ignored.',
  hostname: 'hostname must be text; it was ignored.',
  editor: 'editor must be text; it was ignored.',
  terminal: 'terminal must be text; it was ignored.',
};

export const NOT_AN_OBJECT_PROBLEM = 'The file is not a JSON object.';

export const MachineConfigJson = Schema.fromJsonString(Schema.Unknown);

export class MachineConfigUnreadable extends Schema.TaggedError<
  MachineConfigUnreadable,
  { readonly brand: unique symbol }
>()('MachineConfigUnreadable', { path: Schema.String, reason: Schema.String }) {}

export interface MachineConfigRead {
  config: MachineConfig;
  problems: string[];
  unreadable: boolean;
}
