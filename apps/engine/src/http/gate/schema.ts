import type {
  BodyTooLarge,
  ContentTypeInvalid,
  InspectReadOnly,
  LocalOnly,
  NotMachineOwner,
  RequestFailed,
  RouteNotFound,
  ScopeRefused,
} from '@shinsa/core/engine-api/schema';
import type { Types } from 'effect';

export type GateError =
  | BodyTooLarge
  | ContentTypeInvalid
  | InspectReadOnly
  | LocalOnly
  | NotMachineOwner
  | RequestFailed
  | RouteNotFound
  | ScopeRefused
  | Types.unhandled;
