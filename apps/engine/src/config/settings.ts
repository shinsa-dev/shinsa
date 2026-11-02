import { APP_IDENTITY } from '@shinsa/core';
import { Config, Effect, Option, Schema } from 'effect';
import {
  DEFAULT_HOSTNAME,
  HOSTNAME_SETTING,
  MAX_PORT,
  type ServerAddress,
  SettingInvalid,
  WholeNumberText,
  WILDCARD_HOSTS,
} from './schema.ts';

const decodeWholeNumber = Schema.decodeUnknownOption(WholeNumberText);

export const readWholeNumber = Effect.fn('Settings.readWholeNumber')(function* (
  key: string,
  fallback: number
) {
  const raw = yield* Effect.orDie(Config.option(Config.String(key)));
  if (Option.isNone(raw)) return fallback;
  const value = decodeWholeNumber(raw.value);
  if (Option.isNone(value)) {
    return yield* new SettingInvalid({ key, message: `${key} must be a whole number, not "${raw.value}".` });
  }
  return value.value;
});

export const readPort = Effect.fn('Settings.readPort')(function* () {
  const port = yield* readWholeNumber('SHINSA_PORT', APP_IDENTITY.port);
  if (port > MAX_PORT) {
    return yield* new SettingInvalid({
      key: 'SHINSA_PORT',
      message: `SHINSA_PORT must be a port number, not "${port}".`,
    });
  }
  return port;
});

export const readList = Effect.fn('Settings.readList')(function* (key: string, separator: string) {
  const raw = yield* Effect.orDie(Config.String(key).pipe(Config.withDefault('')));
  return raw
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);
});

export const readServerAddress = Effect.fn('Settings.readServerAddress')(function* () {
  const hostname = yield* Effect.orDie(HOSTNAME_SETTING);
  const address: ServerAddress = {
    hostname: WILDCARD_HOSTS.has(hostname) ? DEFAULT_HOSTNAME : hostname,
    port: yield* readPort(),
  };
  return address;
});
