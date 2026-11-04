import { ConfigProvider, Effect } from 'effect';
import { MachineConfigFile } from './machine/service.ts';
import { resolveShinsaPaths } from './paths.ts';
import { createConfigProvider } from './provider.ts';
import type { Env } from './schema.ts';
import { readServerAddress } from './settings.ts';

export const resolveServerAddress = Effect.fn('resolveServerAddress')(function* (env: Env) {
  const machine = yield* (yield* MachineConfigFile).read(resolveShinsaPaths(env).configPath);
  return yield* readServerAddress().pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, createConfigProvider(env, machine.config))
  );
});
