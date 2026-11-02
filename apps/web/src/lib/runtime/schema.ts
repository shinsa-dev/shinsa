import { Schema } from 'effect';
import type { HttpClient } from 'effect/http';
import type { EngineHttp } from './engine-http/service.ts';
import type { EngineClient } from './engine/service.ts';
import type { RemoteClient } from './remote/service.ts';

export type AppServices = EngineClient | EngineHttp | RemoteClient | HttpClient.HttpClient;

export class StepFailed extends Schema.TaggedError<StepFailed, { readonly brand: unique symbol }>()(
  'StepFailed',
  { message: Schema.String }
) {}
