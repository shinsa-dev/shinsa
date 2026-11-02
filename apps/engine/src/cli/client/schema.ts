import type { EngineApi } from '@shinsa/core/engine-api';
import { Schema } from 'effect';
import type { HttpApi, HttpApiClient, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';

export const NOT_RUNNING =
  'Shinsa is not running. Start it with `shinsa start`, or open the Shinsa app on a Mac.';

export const REQUEST_FAILED = 'request_failed';

export type EngineWake = () => Promise<boolean>;

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

type EngineGroups = typeof EngineApi extends HttpApi.HttpApi<string, infer Groups> ? Groups : never;

type EngineCall<Endpoint extends HttpApiEndpoint.ConstraintRequest> = (
  request: HttpApiEndpoint.ClientRequest<
    Endpoint['~Params'],
    Endpoint['~Query'],
    Endpoint['~Payload'],
    Endpoint['~Headers'],
    'decoded-only'
  >
) => Promise<HttpApiClient.SuccessType<Endpoint['~Success']>>;

export type EngineCalls = {
  readonly [Group in EngineGroups as HttpApiGroup.Identifier<Group>]: {
    readonly [Id in keyof Group['endpoints']]: Group['endpoints'][Id] extends infer Endpoint extends
      HttpApiEndpoint.ConstraintRequest
      ? EngineCall<Endpoint>
      : never;
  };
};
