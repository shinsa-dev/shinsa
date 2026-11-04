import type { DomainError } from '@shinsa/core';
import type { EngineApi } from '@shinsa/core/engine-api';
import { type Effect, Schema } from 'effect';
import type { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';

export const NOT_RUNNING =
  'Shinsa is not running. Start it with `shinsa start`, or open the Shinsa app on a Mac.';

export type EngineWake = Effect.Effect<boolean>;

export interface EngineClientOptions {
  readonly base: string;
  readonly wake?: EngineWake | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
}

export class EngineNotRunning extends Schema.TaggedError<
  EngineNotRunning,
  { readonly brand: unique symbol }
>()('EngineNotRunning', { message: Schema.String }) {}

export class EngineAnswerInvalid extends Schema.TaggedError<
  EngineAnswerInvalid,
  { readonly brand: unique symbol }
>()('EngineAnswerInvalid', { message: Schema.String }) {}

export const EngineErrorBody = Schema.Struct({
  error: Schema.Struct({ code: Schema.optionalKey(Schema.String), message: Schema.String }),
});

export type EngineFailure = DomainError | EngineNotRunning | EngineAnswerInvalid;

type EngineGroups = typeof EngineApi extends HttpApi.HttpApi<string, infer Groups> ? Groups : never;

type EngineCall<Endpoint extends HttpApiEndpoint.ConstraintRequest> = (
  request: HttpApiEndpoint.ClientRequest<
    Endpoint['~Params'],
    Endpoint['~Query'],
    Endpoint['~Payload'],
    Endpoint['~Headers'],
    'decoded-only'
  >
) => Effect.Effect<HttpApiClient.SuccessType<Endpoint['~Success']>, EngineFailure>;

export type EngineCalls = {
  readonly [Group in EngineGroups as HttpApiGroup.Identifier<Group>]: {
    readonly [Id in keyof Group['endpoints']]: Group['endpoints'][Id] extends infer Endpoint extends
      HttpApiEndpoint.ConstraintRequest
      ? EngineCall<Endpoint>
      : never;
  };
};
