import { Schema } from 'effect';
import { Salvaged, SalvagedItems, SalvagedOrNull } from '../domain/salvage.ts';

export const BriefingPick = Schema.Struct({
  task: Schema.optionalKey(Schema.Unknown),
  task_id: Schema.optionalKey(Schema.Unknown),
  taskId: Schema.optionalKey(Schema.Unknown),
  why: SalvagedOrNull(Schema.String),
});

export type BriefingPick = typeof BriefingPick.Type;

export const BriefingAnswer = Schema.Struct({
  now: SalvagedOrNull(BriefingPick),
  next: SalvagedItems(BriefingPick),
  note: Salvaged(Schema.UndefinedOr(Schema.NullOr(Schema.String)), () => undefined),
});
