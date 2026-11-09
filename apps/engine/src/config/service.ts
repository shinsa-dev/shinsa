import { join, resolve } from 'node:path';
import { ConfigProvider, Context, Effect, Layer, Option } from 'effect';
import { resolveBundlePath, type ShinsaBundle } from '../instance/bundle.ts';
import { MachineConfigFile } from './machine/service.ts';
import { resolveShinsaPaths, resolveUserHome } from './paths.ts';
import { createConfigProvider } from './provider.ts';
import {
  BROWSER_DIR,
  DATABASE_FILE,
  ENGINE_SETTINGS,
  type Env,
  INSPECT_ON,
  LOOPBACK_HOSTS,
  RETRY_DEFAULTS,
  type ServerConfig,
  WILDCARD_HOSTS,
} from './schema.ts';
import { readList, readPort, readWholeNumber } from './settings.ts';

export class EngineConfig extends Context.Service<EngineConfig, ServerConfig>()(
  'shinsa/engine/config/EngineConfig'
) {
  static readonly layer = (env: Env, bundle: ShinsaBundle | null) =>
    Layer.effect(
      EngineConfig,
      Effect.gen(function* () {
        const paths = resolveShinsaPaths(env);
        const machine = yield* (yield* MachineConfigFile).read(paths.configPath);
        const read = Effect.gen(function* () {
          const settings = yield* Effect.orDie(ENGINE_SETTINGS);
          const dataDir = paths.dataDir;
          const configured = WILDCARD_HOSTS.has(settings.hostname) ? [] : [settings.hostname];
          const extraHosts = yield* readList('SHINSA_ALLOWED_HOSTS', ',');
          const config: ServerConfig = {
            home: paths.home,
            configPath: paths.configPath,
            dataDir,
            databasePath: join(dataDir, DATABASE_FILE),
            worktreesDir: Option.getOrElse(settings.worktreesDir, () => join(dataDir, 'worktrees')),
            worktreesDirFromEnvironment: Option.isSome(settings.worktreesDir),
            checkBasesDir: join(dataDir, 'check-bases'),
            scratchDir: join(dataDir, 'scratch'),
            cachesDir: join(dataDir, 'caches'),
            evidenceDir: join(dataDir, 'evidence'),
            attachmentsDir: join(dataDir, 'attachments'),
            transcriptsDir: join(dataDir, 'transcripts'),
            browserDir: join(dataDir, BROWSER_DIR),
            pluginDir: Option.getOrElse(settings.pluginDir, () =>
              bundle ? resolveBundlePath(bundle, 'plugin') : resolve(import.meta.dirname, '../../plugin')
            ),
            webDir: Option.getOrElse(settings.webDir, () =>
              bundle ? resolveBundlePath(bundle, 'web') : resolve(import.meta.dirname, '../../../web/dist')
            ),
            port: yield* readPort(),
            hostname: settings.hostname,
            allowedHosts: [...new Set([...LOOPBACK_HOSTS, ...configured, ...extraHosts])],
            userHome: resolveUserHome(env),
            machine,
            roots: yield* readList('SHINSA_ROOTS', ':'),
            inspect: settings.inspect === INSPECT_ON,
            simulateMissing: yield* readList('SHINSA_SIMULATE_MISSING', ','),
            editor: Option.getOrNull(settings.editor),
            terminal: settings.terminal,
            settleDelayMs: yield* readWholeNumber(
              'SHINSA_SETTLE_DELAY_MS',
              RETRY_DEFAULTS.SHINSA_SETTLE_DELAY_MS
            ),
            pushRetryMs: yield* readWholeNumber('SHINSA_PUSH_RETRY_MS', RETRY_DEFAULTS.SHINSA_PUSH_RETRY_MS),
            overloadRetryMs: yield* readWholeNumber(
              'SHINSA_OVERLOAD_RETRY_MS',
              RETRY_DEFAULTS.SHINSA_OVERLOAD_RETRY_MS
            ),
            remoteOrigin: settings.remoteOrigin,
            previewOrigin: settings.previewOrigin,
          };
          return config;
        });
        return yield* read.pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, createConfigProvider(env, machine.config))
        );
      })
    ).pipe(Layer.provide(MachineConfigFile.layer));
}
