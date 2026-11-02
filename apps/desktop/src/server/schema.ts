import { Duration, Predicate, Schema, SchemaGetter } from 'effect';

export const DEV_PORT = 5181;

export const SERVER_HOST = '127.0.0.1';

export const HEALTH_TIMEOUT = Duration.millis(1500);

const EngineUnreachableReason = Schema.Literals(['refused', 'timeout', 'invalid']);

export class EngineUnreachable extends Schema.TaggedError<
  EngineUnreachable,
  { readonly brand: unique symbol }
>()('EngineUnreachable', { origin: Schema.String, reason: EngineUnreachableReason }) {}

export const ServerHealth = Schema.Struct({
  version: Schema.NullOr(Schema.String),
  working: Schema.Int,
  updating: Schema.Boolean,
});

export type ServerHealth = typeof ServerHealth.Type;

export const HealthAnswer = Schema.Struct({
  ok: Schema.Boolean,
  version: Schema.optionalKey(Schema.Unknown),
  working: Schema.optionalKey(Schema.Unknown),
  restart: Schema.optionalKey(Schema.Unknown),
}).pipe(
  Schema.decodeTo(ServerHealth, {
    decode: SchemaGetter.transform(({ version, working, restart }) => ({
      version: Predicate.isString(version) && version !== '' ? version : null,
      working: Predicate.isNumber(working) && Number.isInteger(working) && working > 0 ? working : 0,
      updating: restart === 'idle',
    })),
    encode: SchemaGetter.transform(({ version, working, updating }) => ({
      ok: true,
      ...(version === null ? {} : { version }),
      working,
      ...(updating ? { restart: 'idle' } : {}),
    })),
  })
);

const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }));

export const PortSetting = Schema.Union([
  Port,
  Schema.String.check(Schema.makeFilter((text) => text.trim() !== '')).pipe(
    Schema.decodeTo(Port, {
      decode: SchemaGetter.transform(Number),
      encode: SchemaGetter.transform(String),
    })
  ),
]);

export const ConfigFile = Schema.fromJsonString(Schema.Struct({ port: PortSetting }));
