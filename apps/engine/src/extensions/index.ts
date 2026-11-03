import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { ExtensionPlace, ExtensionsSnapshot, LoadedExtensions } from '@shinsa/core';
import { Effect, Scope } from 'effect';
import { resolveSharedConfigDir } from '../accounts/paths.ts';
import { describeError } from '../log/redact.ts';
import { edgeRuntime } from '../runtime/edge.ts';
import {
  type ExtensionsHandle,
  type ExtensionsOptions,
  ServerCheckFailed,
  SnapshotRefreshFailed,
  UsageReadFailed,
} from './registry/schema.ts';
import { makeExtensions } from './registry/service.ts';
import { EXTENSIONS_FILE, USAGE_FILE } from './schema.ts';
import { createSessionLoader, type SessionExtensions } from './session.ts';
import { SIGN_IN_CALLBACK_PATH } from './sign-in.ts';
import { ExtensionStore } from './store.ts';
import { UsageIndex } from './usage.ts';

export type { ServerCheck } from './health.ts';
export type { ExtensionsOptions } from './registry/schema.ts';
export type { SessionExtensionSource, SessionExtensions } from './session.ts';
export { isSameExtensionSet, resolveDeferredInstructions } from './session.ts';

export class Extensions {
  readonly #options: ExtensionsOptions;
  readonly #handle: ExtensionsHandle;

  constructor(options: ExtensionsOptions) {
    this.#options = options;
    const now = options.now ?? Date.now;
    const env = options.env ?? process.env;
    const { config, check } = options;
    const usage =
      options.usage ??
      new UsageIndex({
        sources: [
          { dir: join(resolveSharedConfigDir(env, config.userHome), 'projects'), kind: 'claude' },
          ...(config.transcriptsDir ? [{ dir: config.transcriptsDir, kind: 'shinsa' as const }] : []),
        ],
        cachePath: config.dataDir ? join(config.dataDir, USAGE_FILE) : null,
        now,
      });
    this.#handle = edgeRuntime.runSync(
      makeExtensions({
        state: Effect.sync(options.state),
        config,
        env,
        secrets: options.secrets,
        store: new ExtensionStore(join(config.home, EXTENSIONS_FILE)),
        usage: {
          view: Effect.sync(() => ({
            read: usage.read(),
            selectServer: (name) => usage.selectServer(name),
            selectSkill: (name) => usage.selectSkill(name),
          })),
          isStale: (maxAgeMs) => Effect.sync(() => usage.isStale(maxAgeMs)),
          refresh: Effect.tryPromise({
            try: () => usage.refresh(),
            catch: (error) => new UsageReadFailed({ message: describeError(error) }),
          }),
          stop: Effect.promise(() => usage.stop()),
        },
        redirectUrl: Effect.sync(() => `${options.baseUrl()}${SIGN_IN_CALLBACK_PATH}`),
        now: Effect.sync(now),
        random: Effect.sync(() => randomBytes(24).toString('base64url')),
        fetch: options.fetch,
        check: check
          ? (definition) =>
              Effect.tryPromise({
                try: () => check(definition),
                catch: (error) => new ServerCheckFailed({ message: describeError(error) }),
              })
          : null,
        refresh: Effect.try({
          try: () => {
            this.snapshot();
          },
          catch: (error) => new SnapshotRefreshFailed({ message: describeError(error) }),
        }),
      }).pipe(Scope.provide(edgeRuntime.runSync(Scope.make())))
    );
  }

  isCallback(pathname: string) {
    return pathname === SIGN_IN_CALLBACK_PATH;
  }

  syncUsage() {
    return edgeRuntime.runPromise(this.#handle.syncUsage);
  }

  stop() {
    return edgeRuntime.runPromise(this.#handle.stop);
  }

  readSnapshot(): ExtensionsSnapshot {
    return edgeRuntime.runSync(this.#handle.readSnapshot);
  }

  syncSnapshot() {
    edgeRuntime.runSync(this.#handle.syncSnapshot);
  }

  snapshot(): ExtensionsSnapshot {
    return edgeRuntime.runSync(this.#handle.snapshot);
  }

  createServer(fields: unknown) {
    return edgeRuntime.runSync(this.#handle.createServer(fields));
  }

  updateServer(id: unknown, fields: unknown) {
    return edgeRuntime.runSync(this.#handle.updateServer(id, fields));
  }

  removeServer(id: unknown) {
    return edgeRuntime.runSync(this.#handle.removeServer(id));
  }

  updateServerChoice(id: unknown, fields: unknown) {
    return edgeRuntime.runSync(this.#handle.updateServerChoice(id, fields));
  }

  updateSkillChoice(id: unknown, enabled: unknown) {
    return edgeRuntime.runSync(this.#handle.updateSkillChoice(id, enabled));
  }

  updatePluginChoice(id: unknown, enabled: unknown) {
    return edgeRuntime.runSync(this.#handle.updatePluginChoice(id, enabled));
  }

  updateOptimizer(fields: unknown) {
    return edgeRuntime.runSync(this.#handle.updateOptimizer(fields));
  }

  check(id?: unknown) {
    return edgeRuntime.runPromise(this.#handle.check(id));
  }

  startSignIn(id: unknown) {
    return edgeRuntime.runPromise(this.#handle.startSignIn(id));
  }

  finishSignIn(url: URL) {
    return edgeRuntime.runPromise(this.#handle.finishSignIn(url));
  }

  signOut(id: unknown) {
    return edgeRuntime.runSync(this.#handle.signOut(id));
  }

  resolveSession(place: ExtensionPlace, pin: LoadedExtensions | null = null): Promise<SessionExtensions> {
    return edgeRuntime.runPromise(this.#handle.resolveSession(place, pin));
  }

  createLoader(extensions: SessionExtensions) {
    return createSessionLoader(extensions, this.#options.open);
  }
}
