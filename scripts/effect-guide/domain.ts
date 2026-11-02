import { Effect, Schema } from 'effect';

export const MachineId = Schema.String.check(Schema.isPattern(/^[a-z0-9-]{3,64}$/)).pipe(
  Schema.brand('MachineId')
);

export type MachineId = typeof MachineId.Type;

const MachineStatus = Schema.Literals(['online', 'offline']);

export class Machine extends Schema.Class<Machine, { readonly brand: unique symbol }>('shinsa/guide/Machine')(
  {
    id: MachineId,
    name: Schema.NonEmptyString.check(Schema.isMaxLength(64)),
    status: MachineStatus,
    pairedAt: Schema.Int,
  }
) {}

export const PairRequest = Schema.Struct({
  id: MachineId,
  name: Machine.fields.name,
});

export type PairRequest = typeof PairRequest.Type;

class InvalidPayload extends Schema.TaggedError<InvalidPayload, { readonly brand: unique symbol }>()(
  'InvalidPayload',
  { message: Schema.String },
  { httpApiStatus: 400 }
) {}

export class MachineNotFound extends Schema.TaggedError<MachineNotFound, { readonly brand: unique symbol }>()(
  'MachineNotFound',
  { machineId: MachineId },
  { httpApiStatus: 404 }
) {}

export class MachineAlreadyPaired extends Schema.TaggedError<
  MachineAlreadyPaired,
  { readonly brand: unique symbol }
>()('MachineAlreadyPaired', { machineId: MachineId }, { httpApiStatus: 409 }) {}

const decodePairRequestText = Schema.decodeUnknownEffect(Schema.fromJsonString(PairRequest));

export const parsePairRequest = Effect.fn('parsePairRequest')((text: string) =>
  decodePairRequestText(text).pipe(Effect.mapError((issue) => new InvalidPayload({ message: issue.message })))
);
